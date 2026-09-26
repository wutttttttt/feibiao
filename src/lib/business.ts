import { Prisma, type Good } from '@prisma/client';
import { db } from './db';
import { AppError, requireCustomerAccess, requirePartnerAccess, requirePermission, type Actor } from './auth';
import { asString, docNo, json, money, positiveMoney, rateAmount, serialize, splitDiscount } from './common';
import { requestKey } from './request-key';

type Tx = Prisma.TransactionClient;
const txOpts = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 } as const;
const state = (g: Good) => ({ holderKind: g.holderKind, holderPartnerId: g.holderPartnerId, locationId: g.locationId, custodianUserId: g.custodianUserId, quality: g.quality, occupancy: g.occupancy, sourceOwnerPartnerId: g.ownerPartnerId, currentOwnerKind: g.currentOwnerKind, currentOwnerPartnerId: g.currentOwnerPartnerId, version: g.version, returnedUpstreamAt: g.returnedUpstreamAt });
async function lockGood(tx: Tx, actor: Actor, goodId: string) {
  const rows = await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "Good" WHERE id = ${goodId} AND "merchantId" = ${actor.merchantId} FOR UPDATE`;
  if (!rows.length) throw new AppError(404, '找不到货品');
  return tx.good.findFirstOrThrow({ where: { id: goodId, merchantId: actor.merchantId } });
}
async function move(tx: Tx, actor: Actor, good: Good, data: Prisma.GoodUncheckedUpdateInput, action: string, refType: string, refId: string, reason?: string) {
  const updated = await tx.good.update({ where: { id: good.id }, data: { ...data, version: { increment: 1 } } });
  await tx.inventoryEvent.create({ data: { merchantId: actor.merchantId, goodId: good.id, action, before: json(state(good)), after: json(state(updated)), referenceType: refType, referenceId: refId, actorId: actor.id, reason } });
  return updated;
}
async function audit(tx: Tx, actor: Actor, action: string, entityType: string, entityId: string, before?: unknown, after?: unknown, reason?: string) {
  await tx.auditLog.create({ data: { merchantId: actor.merchantId, actorId: actor.id, action, entityType, entityId, before: before == null ? Prisma.JsonNull : json(before), after: after == null ? Prisma.JsonNull : json(after), reason } });
}
async function transact<T>(fn: (tx: Tx) => Promise<T>) { return db.$transaction(async tx => { const result = await fn(tx); const key = requestKey.getStore(); if (key) await tx.idempotencyKey.create({ data: { ...key, result: json(serialize(result)) } }); return result; }, txOpts); }
function ids(values: unknown, name: string): string[] {
  if (!Array.isArray(values) || !values.length || values.some(v => typeof v !== 'string') || new Set(values).size !== values.length) throw new AppError(400, `${name}须选择且不可重复`);
  return values as string[];
}
async function partner(tx: Tx, actor: Actor, id: string) {
  const result = await tx.partner.findFirst({ where: { id, merchantId: actor.merchantId, archivedAt: null } });
  if (!result) throw new AppError(404, '找不到合作方');
  requirePartnerAccess(actor,result);
  return result;
}
async function location(tx: Tx, actor: Actor, id: string) {
  const result = await tx.location.findFirst({ where: { id, merchantId: actor.merchantId, active: true } });
  if (!result) throw new AppError(404, '找不到存放位置');
  return result;
}

export async function createPartner(actor: Actor, input: any) {
  requirePermission(actor, 'partners');
  if (input.settlementType || input.settlementFixed || input.settlementRateBp) requirePermission(actor,'finance');
  return transact(async tx => {
    const roles = Array.isArray(input.roles) ? input.roles.filter((r: unknown) => ['CUSTOMER','OWNER','SUPPLIER','AGENT'].includes(String(r))) : [];
    const settlementType = input.settlementType === 'FIXED' || input.settlementType === 'RATE' ? input.settlementType : null;
    const rate = input.settlementRateBp == null || input.settlementRateBp === '' ? null : Number(input.settlementRateBp);
    if (rate != null && (!Number.isInteger(rate) || rate < 0 || rate > 10000)) throw new AppError(400, '分成比例无效');
    const result = await tx.partner.create({ data: { merchantId: actor.merchantId, externalId:input.externalId||null, name: asString(input.name, '名称'), phone: input.phone || null, roles, note: input.note || null, settlementType, settlementRateBp: rate, settlementFixedCents: input.settlementFixed == null || input.settlementFixed === '' ? null : money(input.settlementFixed) } });
    if(actor.role!=='OWNER'&&roles.includes('CUSTOMER')){
      const permissions={...(actor.permissions as Record<string,unknown>),customerIds:[...new Set([...(Array.isArray((actor.permissions as any).customerIds)?(actor.permissions as any).customerIds:[]),result.id])]};
      await tx.user.update({where:{id:actor.id},data:{permissions:json(permissions)}});
    }
    await audit(tx, actor, 'CREATE', 'PARTNER', result.id, null, result);
    return result;
  });
}
export async function updatePartner(actor: Actor, id: string, input: any) {
  requirePermission(actor, 'partners');
  if (input.settlementType !== undefined || input.settlementFixed !== undefined || input.settlementRateBp !== undefined) requirePermission(actor,'finance');
  return transact(async tx => {
    const before = await partner(tx, actor, id);
    const data: Prisma.PartnerUpdateInput = {};
    if (input.name !== undefined) data.name = asString(input.name, '名称');
    if (input.phone !== undefined) data.phone = input.phone || null;
    if (input.note !== undefined) data.note = input.note || null;
    if (input.roles !== undefined) {
      if (!Array.isArray(input.roles) || input.roles.some((r:unknown)=>!['CUSTOMER','OWNER','SUPPLIER','AGENT'].includes(String(r)))) throw new AppError(400,'合作方身份无效');
      data.roles = input.roles;
    }
    if (input.settlementType !== undefined) {
      if (input.settlementType && !['FIXED','RATE'].includes(input.settlementType)) throw new AppError(400,'结算方式无效');
      data.settlementType = input.settlementType || null;
    }
    if (input.settlementFixed !== undefined) data.settlementFixedCents = input.settlementFixed ? money(input.settlementFixed) : null;
    if (input.settlementRateBp !== undefined) {
      const rate=input.settlementRateBp === '' ? null : Number(input.settlementRateBp);
      if(rate!=null&&(!Number.isInteger(rate)||rate<0||rate>10000))throw new AppError(400,'分成比例无效');
      data.settlementRateBp=rate;
    }
    if (data.settlementType !== undefined || data.settlementFixedCents !== undefined || data.settlementRateBp !== undefined) data.ruleVersion = { increment: 1 };
    const result = await tx.partner.update({ where: { id }, data });
    await audit(tx, actor, 'UPDATE', 'PARTNER', id, before, result);
    return result;
  });
}
export async function createGood(actor: Actor, input: any) {
  requirePermission(actor, 'goods');
  if (input.cost || input.floor || input.settlementType || input.settlementFixed || input.settlementRateBp) requirePermission(actor,'cost');
  return transact(async tx => {
    const kind = input.ownershipKind === 'CONSIGN' ? 'CONSIGN' : 'OWN';
    const owner = kind === 'CONSIGN' ? await partner(tx, actor, asString(input.ownerPartnerId, '上游货主')) : null;
    if (input.locationId) await location(tx, actor, input.locationId);
    if (input.sourcePartnerId) await partner(tx, actor, input.sourcePartnerId);
    const code = input.code ? asString(input.code, '货号') : docNo('FC');
    const ruleType = kind === 'CONSIGN' ? (input.settlementType || owner?.settlementType) : null;
    const fixed = input.settlementFixed != null && input.settlementFixed !== '' ? money(input.settlementFixed) : owner?.settlementFixedCents;
    const rate = input.settlementRateBp != null && input.settlementRateBp !== '' ? Number(input.settlementRateBp) : owner?.settlementRateBp;
    if(ruleType!=null&&!['FIXED','RATE'].includes(ruleType))throw new AppError(400,'结算方式无效');
    if(rate!=null&&(!Number.isInteger(rate)||rate<0||rate>10000))throw new AppError(400,'分成比例无效');
    const g = await tx.good.create({ data: { merchantId: actor.merchantId, code, externalId: input.externalId || null, name: asString(input.name, '货品名称'), category: asString(input.category, '品类'), attributes: json(input.attributes || {}), weightGrams: input.weightGrams ? new Prisma.Decimal(String(input.weightGrams)) : null, certificateNo: input.certificateNo || null, conditionNote: input.conditionNote || null, ownershipKind: kind, ownerPartnerId: owner?.id || null, currentOwnerKind: owner ? 'PARTNER' : 'MERCHANT', currentOwnerPartnerId: owner?.id || null, sourcePartnerId: input.sourcePartnerId || null, costCents: input.cost ? money(input.cost) : null, askingCents: input.asking ? money(input.asking) : null, floorCents: input.floor ? money(input.floor) : null, settlementType: ruleType || null, settlementFixedCents: fixed ?? null, settlementRateBp: rate ?? null, ruleVersion: owner?.ruleVersion || null, locationId: input.locationId || null, custodianUserId: actor.id } });
    await tx.inventoryEvent.create({ data: { merchantId: actor.merchantId, goodId: g.id, action: kind === 'CONSIGN' ? 'CONSIGN_RECEIPT' : 'OWN_RECEIPT', before: json({}), after: json(state(g)), referenceType: 'GOOD', referenceId: g.id, actorId: actor.id } });
    await audit(tx, actor, 'CREATE', 'GOOD', g.id, null, g);
    return g;
  });
}
export async function updateGood(actor: Actor, id: string, input: any) {
  requirePermission(actor, 'goods');
  return transact(async tx => {
    const before = await lockGood(tx, actor, id);
    const data: Prisma.GoodUpdateInput = {};
    for (const key of ['name','category','certificateNo','conditionNote'] as const) if (input[key] !== undefined) (data as any)[key] = input[key];
    if (input.attributes !== undefined) data.attributes = json(input.attributes);
    if (input.weightGrams !== undefined) data.weightGrams = input.weightGrams ? new Prisma.Decimal(String(input.weightGrams)) : null;
    if (input.asking !== undefined) data.askingCents = input.asking ? money(input.asking) : null;
    if (input.cost !== undefined) { requirePermission(actor, 'cost'); data.costCents = input.cost ? money(input.cost) : null; }
    if (input.floor !== undefined) { requirePermission(actor, 'cost'); data.floorCents = input.floor ? money(input.floor) : null; }
    const result = await tx.good.update({ where: { id }, data });
    await audit(tx, actor, 'UPDATE_PROFILE', 'GOOD', id, before, result);
    return result;
  });
}
export async function moveLocation(actor: Actor, goodId: string, locationId: string, reason?: string) {
  requirePermission(actor, 'stock');
  return transact(async tx => {
    await location(tx, actor, locationId);
    const good = await lockGood(tx, actor, goodId);
    if (good.holderKind !== 'MERCHANT' || good.occupancy !== 'FREE' || good.returnedUpstreamAt) throw new AppError(409, '这件货当前不能调整摊位位置');
    const result = await move(tx, actor, good, { locationId, custodianUserId: actor.id }, 'LOCATION_MOVE', 'GOOD', goodId, reason);
    await audit(tx, actor, 'LOCATION_MOVE', 'GOOD', goodId, state(good), state(result), reason);
    return result;
  });
}
export async function createLoan(actor: Actor, input: any) {
  requirePermission(actor, 'loans');
  const goodIds = ids(input.goodIds, '货品');
  return transact(async tx => {
    const p = await partner(tx, actor, asString(input.partnerId, '拿货人'));
    const loan = await tx.loan.create({ data: { merchantId: actor.merchantId, number: docNo('NH'), partnerId: p.id, handoverUserId: actor.id, receiverName: asString(input.receiverName || p.name, '实际接收人'), dueAt: input.dueAt ? new Date(input.dueAt) : null, note: input.note || null } });
    for (const goodId of [...goodIds].sort()) {
      const g = await lockGood(tx, actor, goodId);
      if (g.holderKind !== 'MERCHANT' || g.occupancy !== 'FREE' || g.quality !== 'NORMAL' || g.returnedUpstreamAt) throw new AppError(409, `${g.code} 不能拿货`);
      await tx.loanItem.create({ data: { merchantId: actor.merchantId, loanId: loan.id, goodId, currentHolderPartnerId: p.id, responsiblePartnerId: p.id, referencePriceCents: input.prices?.[goodId] ? money(input.prices[goodId]) : g.askingCents, agreedSettlementCents: input.agreed?.[goodId] ? money(input.agreed[goodId]) : null } });
      await move(tx, actor, g, { holderKind: 'PARTNER', holderPartnerId: p.id, locationId: null, custodianUserId: null, occupancy: 'LOAN' }, 'LOAN_OUT', 'LOAN', loan.id);
    }
    await audit(tx, actor, 'CREATE', 'LOAN', loan.id, null, { goodIds, partnerId: p.id });
    return tx.loan.findUniqueOrThrow({ where: { id: loan.id }, include: { items: true } });
  });
}
export async function returnLoanItem(actor: Actor, loanItemId: string, input: any) {
  requirePermission(actor, 'loans');
  return transact(async tx => {
    const item = await tx.loanItem.findFirst({ where: { id: loanItemId, merchantId: actor.merchantId, status: 'OUT' } });
    if (!item) throw new AppError(409, '这件货已处理或不存在');
    requireCustomerAccess(actor,item.currentHolderPartnerId);
    const g = await lockGood(tx, actor, item.goodId);
    if (g.occupancy !== 'LOAN' || g.holderPartnerId !== item.currentHolderPartnerId) throw new AppError(409, '货品与拿货单状态不一致');
    const damaged = input.condition === 'DAMAGED';
    if (input.locationId) await location(tx, actor, input.locationId);
    await tx.loanItem.update({ where: { id: item.id }, data: { status: 'RETURNED', resolvedAt: new Date(), returnCondition: damaged ? 'DAMAGED' : 'NORMAL' } });
    await move(tx, actor, g, { holderKind: 'MERCHANT', holderPartnerId: null, locationId: input.locationId || null, custodianUserId: actor.id, occupancy: 'FREE', quality: damaged ? 'HOLD' : 'NORMAL' }, damaged ? 'RETURN_DAMAGE' : 'LOAN_RETURN', 'LOAN_ITEM', item.id, input.note);
    if (damaged) await tx.damage.create({ data: { merchantId: actor.merchantId, goodId: g.id, description: asString(input.note, '货损说明'), actorId: actor.id } });
    await audit(tx, actor, 'RETURN', 'LOAN_ITEM', item.id, item, { condition: input.condition, locationId: input.locationId }, input.note);
    return { id: item.id, condition: damaged ? 'DAMAGED' : 'NORMAL' };
  });
}
export async function transferLoanItem(actor: Actor, loanItemId: string, input: any) {
  requirePermission(actor, 'transfer');
  return transact(async tx => {
    const item = await tx.loanItem.findFirst({ where: { id: loanItemId, merchantId: actor.merchantId, status: 'OUT' } });
    if (!item) throw new AppError(409, '拿货明细已处理');
    requireCustomerAccess(actor,item.currentHolderPartnerId);
    if (!input.confirmed) {
      await tx.loanItem.update({ where: { id: item.id }, data: { transferNote: asString(input.note, '待核实转交信息') } });
      await audit(tx, actor, 'TRANSFER_UNVERIFIED', 'LOAN_ITEM', item.id, null, input, input.note);
      return { status: 'UNVERIFIED' };
    }
    const receiver = await partner(tx, actor, asString(input.partnerId, '实际接收人'));
    const g = await lockGood(tx, actor, item.goodId);
    if (g.occupancy !== 'LOAN') throw new AppError(409, '货品不是外借状态');
    await tx.loanItem.update({ where: { id: item.id }, data: { currentHolderPartnerId: receiver.id, responsiblePartnerId: receiver.id, transferNote: input.note || null } });
    await move(tx, actor, g, { holderPartnerId: receiver.id }, 'TRANSFER', 'LOAN_ITEM', item.id, input.note);
    await audit(tx, actor, 'TRANSFER_CONFIRMED', 'LOAN_ITEM', item.id, item, { receiverId: receiver.id }, input.note);
    return { status: 'CONFIRMED', receiverId: receiver.id };
  });
}
export async function reserveGood(actor: Actor, goodId: string, reserve: boolean) {
  requirePermission(actor, 'sales');
  return transact(async tx => {
    const g = await lockGood(tx, actor, goodId);
    if (g.holderKind !== 'MERCHANT' || g.quality !== 'NORMAL' || g.occupancy !== (reserve ? 'FREE' : 'RESERVED')) throw new AppError(409, '货品当前不能执行此操作');
    return move(tx, actor, g, { occupancy: reserve ? 'RESERVED' : 'FREE' }, reserve ? 'RESERVE' : 'UNRESERVE', 'GOOD', goodId);
  });
}
export async function createSale(actor: Actor, input: any) {
  requirePermission(actor, 'sales');
  if (!Array.isArray(input.items) || !input.items.length) throw new AppError(400, '请选择成交货品');
  const saleItems = input.items as Array<{ goodId: string; price: string }>;
  if (new Set(saleItems.map(i => i.goodId)).size !== saleItems.length) throw new AppError(400, '成交货品不可重复');
  const gross = saleItems.map(i => positiveMoney(i.price, '成交价'));
  const discounts = splitDiscount(gross, input.discount ? money(input.discount) : 0n);
  return transact(async tx => {
    const customer = await partner(tx, actor, asString(input.customerId, '客户'));
    const sale = await tx.sale.create({ data: { merchantId: actor.merchantId, number: docNo('XS'), customerId: customer.id, dueAt: input.dueAt ? new Date(input.dueAt) : null, note: input.note || null } });
    for (const item of [...saleItems.map((v,i) => ({ ...v, gross: gross[i], discount: discounts[i] }))].sort((a,b) => a.goodId.localeCompare(b.goodId))) {
      const g = await lockGood(tx, actor, item.goodId);
      if (g.quality !== 'NORMAL' || g.returnedUpstreamAt) throw new AppError(409, `${g.code} 不可成交`);
      const loanItem = g.occupancy === 'LOAN' ? await tx.loanItem.findFirst({ where: { merchantId: actor.merchantId, goodId: g.id, status: 'OUT', currentHolderPartnerId: customer.id } }) : null;
      if (g.occupancy === 'LOAN' && !loanItem) throw new AppError(409, `${g.code} 正由其他人持有`);
      if (g.occupancy !== 'LOAN' && !(g.holderKind === 'MERCHANT' && ['FREE','RESERVED'].includes(g.occupancy))) throw new AppError(409, `${g.code} 已被占用`);
      const net = item.gross - item.discount;
      const delivered = Boolean(loanItem || input.delivered);
      const row = await tx.saleItem.create({ data: { merchantId: actor.merchantId, saleId: sale.id, goodId: g.id, loanItemId: loanItem?.id, grossCents: item.gross, discountCents: item.discount, netCents: net, deliveryStatus: delivered ? 'DELIVERED' : 'PENDING', deliveredAt: delivered ? new Date() : null } });
      if (loanItem) await tx.loanItem.update({ where: { id: loanItem.id }, data: { status: 'SOLD', resolvedAt: new Date() } });
      await move(tx, actor, g, { occupancy: 'SOLD', holderKind: delivered ? 'PARTNER' : 'MERCHANT', holderPartnerId: delivered ? customer.id : null, currentOwnerKind: delivered ? 'PARTNER' : g.currentOwnerKind, currentOwnerPartnerId: delivered ? customer.id : g.currentOwnerPartnerId, deliveredAt: delivered ? new Date() : null, locationId: delivered ? null : g.locationId }, 'SALE', 'SALE_ITEM', row.id);
      if (g.ownershipKind === 'CONSIGN') {
        if (!g.ownerPartnerId || !g.settlementType) throw new AppError(400, `${g.code} 缺少上游结算资料`);
        const payable = g.settlementType === 'FIXED' ? g.settlementFixedCents : g.settlementType === 'RATE' && g.settlementRateBp != null ? rateAmount(net, g.settlementRateBp) : null;
        if (payable == null) throw new AppError(400, `${g.code} 上游结算资料不完整`);
        await tx.payable.create({ data: { merchantId: actor.merchantId, ownerId: g.ownerPartnerId, saleItemId: row.id, amountCents: payable, ruleSnapshot: json({ type: g.settlementType, fixedCents: g.settlementFixedCents?.toString(), rateBp: g.settlementRateBp, ruleVersion: g.ruleVersion, netCents: net.toString(), paymentTrigger: 'CUSTOMER_PAID_IN_FULL' }) } });
      }
    }
    await audit(tx, actor, 'CREATE', 'SALE', sale.id, null, { items: saleItems, discount: input.discount });
    return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: { items: true } });
  });
}
export async function deliverSaleItem(actor: Actor, saleItemId: string) {
  requirePermission(actor, 'sales');
  return transact(async tx => {
    const item = await tx.saleItem.findFirst({ where: { id: saleItemId, merchantId: actor.merchantId, status: 'ACTIVE', deliveryStatus: 'PENDING' }, include: { sale: true } });
    if (!item) throw new AppError(409, '该货已交付或不可交付');
    requireCustomerAccess(actor,item.sale.customerId);
    const g = await lockGood(tx, actor, item.goodId);
    await tx.saleItem.update({ where: { id: item.id }, data: { deliveryStatus: 'DELIVERED', deliveredAt: new Date() } });
    await move(tx, actor, g, { holderKind: 'PARTNER', holderPartnerId: item.sale.customerId, currentOwnerKind: 'PARTNER', currentOwnerPartnerId: item.sale.customerId, locationId: null, deliveredAt: new Date() }, 'DELIVER', 'SALE_ITEM', item.id);
    await audit(tx, actor, 'DELIVER', 'SALE_ITEM', item.id);
    return { id: item.id, status: 'DELIVERED' };
  });
}
export async function addSaleFee(actor: Actor, saleId:string, input:any){
  requirePermission(actor,'finance');
  return transact(async tx=>{
    const sale=await tx.sale.findFirst({where:{id:saleId,merchantId:actor.merchantId}});
    if(!sale)throw new AppError(404,'销售单不存在');
    requireCustomerAccess(actor,sale.customerId);
    const result=await tx.saleFee.create({data:{merchantId:actor.merchantId,saleId,amountCents:positiveMoney(input.amount),reason:asString(input.reason,'费用说明'),actorId:actor.id}});
    await audit(tx,actor,'ADD_FEE','SALE',saleId,null,{feeId:result.id,amount:result.amountCents.toString()},input.reason);
    return result;
  });
}

export async function createReceipt(actor: Actor, input: any) {
  requirePermission(actor, 'receipts');
  const amount = positiveMoney(input.amount);
  const kind = ['SALES','DEPOSIT','ADVANCE'].includes(input.kind) ? input.kind : 'SALES';
  return transact(async tx => {
    const p = await partner(tx, actor, asString(input.partnerId, '客户'));
    const receipt = await tx.receipt.create({ data: { merchantId: actor.merchantId, partnerId: p.id, kind, amountCents: amount, method: asString(input.method || '线下', '收款方式'), note: input.note || null, actorId: actor.id } });
    let allocated = 0n;
    if (kind === 'SALES' && Array.isArray(input.allocations)) {
      for (const allocation of input.allocations) {
        const item = await tx.saleItem.findFirst({ where: { id: allocation.saleItemId, merchantId: actor.merchantId, status: 'ACTIVE', sale: { customerId: p.id } } });
        if (!item) throw new AppError(404, '待核销销售明细不存在');
        const n = positiveMoney(allocation.amount, '核销金额');
        if (item.paidCents + n > item.netCents - item.returnedCents || allocated + n > amount) throw new AppError(409, '核销金额超过未收金额或收款金额');
        await tx.saleItem.update({ where: { id: item.id }, data: { paidCents: { increment: n } } });
        await tx.receiptAllocation.create({ data: { merchantId: actor.merchantId, receiptId: receipt.id, saleItemId: item.id, amountCents: n } });
        allocated += n;
      }
    }
    if (allocated) await tx.receipt.update({ where: { id: receipt.id }, data: { allocatedCents: allocated } });
    await audit(tx, actor, 'RECEIPT', 'RECEIPT', receipt.id, null, { kind, amount: amount.toString(), allocated: allocated.toString() });
    return { ...receipt, allocatedCents: allocated };
  });
}
export async function allocateReceipt(actor: Actor, receiptId: string, allocations: any[]) {
  requirePermission(actor, 'receipts');
  return transact(async tx => {
    const receipt = await tx.receipt.findFirst({ where: { id: receiptId, merchantId: actor.merchantId } });
    if (!receipt || receipt.kind !== 'SALES') throw new AppError(404, '销售收款不存在');
    requireCustomerAccess(actor,receipt.partnerId);
    let total = 0n;
    for (const a of allocations) {
      const item = await tx.saleItem.findFirst({ where: { id: a.saleItemId, merchantId: actor.merchantId, status: 'ACTIVE', sale: { customerId: receipt.partnerId } } });
      if (!item) throw new AppError(404, '销售明细不存在');
      const n = positiveMoney(a.amount);
      if (item.paidCents + n > item.netCents - item.returnedCents || receipt.allocatedCents + total + n > receipt.amountCents) throw new AppError(409, '核销金额超限');
      await tx.saleItem.update({ where: { id: item.id }, data: { paidCents: { increment: n } } });
      await tx.receiptAllocation.create({ data: { merchantId: actor.merchantId, receiptId, saleItemId: item.id, amountCents: n } });
      total += n;
    }
    return tx.receipt.update({ where: { id: receiptId }, data: { allocatedCents: { increment: total } } });
  });
}
export async function allocateOpeningReceipt(actor: Actor, receiptId: string, entryId: string, amountValue: string) {
  requirePermission(actor,'receipts');
  return transact(async tx=>{
    const receipt=await tx.receipt.findFirst({where:{id:receiptId,merchantId:actor.merchantId,kind:'SALES'}});
    const opening=await tx.moneyEntry.findFirst({where:{id:entryId,merchantId:actor.merchantId,kind:'OPENING_AR'}});
    if(!receipt||!opening||receipt.partnerId!==opening.partnerId)throw new AppError(404,'收款与期初应收不匹配');
    requireCustomerAccess(actor,receipt.partnerId);
    const n=positiveMoney(amountValue);
    if(receipt.allocatedCents+n>receipt.amountCents||opening.appliedCents+n>opening.amountCents)throw new AppError(409,'核销超过未结余额');
    await tx.receipt.update({where:{id:receipt.id},data:{allocatedCents:{increment:n}}});
    await tx.moneyEntry.update({where:{id:opening.id},data:{appliedCents:{increment:n}}});
    const result=await tx.openingAllocation.create({data:{merchantId:actor.merchantId,moneyEntryId:opening.id,receiptId:receipt.id,amountCents:n}});
    await audit(tx,actor,'ALLOCATE_OPENING_AR','MONEY_ENTRY',opening.id,null,{receiptId,amount:n.toString()});
    return result;
  });
}
export async function applyDeposit(actor: Actor, receiptId: string, saleItemId: string, amountValue: string) {
  requirePermission(actor, 'receipts');
  return transact(async tx => {
    const receipt = await tx.receipt.findFirst({ where: { id: receiptId, merchantId: actor.merchantId } });
    if (!receipt || !['DEPOSIT','ADVANCE'].includes(receipt.kind)) throw new AppError(404, '押金或预付款不存在');
    requireCustomerAccess(actor,receipt.partnerId);
    const item = await tx.saleItem.findFirst({ where: { id: saleItemId, merchantId: actor.merchantId, status: 'ACTIVE', sale: { customerId: receipt.partnerId } } });
    if (!item) throw new AppError(404, '该客户的销售明细不存在');
    const n = positiveMoney(amountValue);
    if (receipt.allocatedCents + n > receipt.amountCents || item.paidCents + n > item.netCents - item.returnedCents) throw new AppError(409, '抵扣超过可用余额');
    await tx.receipt.update({ where: { id: receipt.id }, data: { allocatedCents: { increment: n } } });
    await tx.saleItem.update({ where: { id: item.id }, data: { paidCents: { increment: n } } });
    await tx.receiptAllocation.create({ data: { merchantId: actor.merchantId, receiptId, saleItemId, amountCents: n } });
    await audit(tx, actor, 'APPLY_DEPOSIT', 'RECEIPT', receiptId, null, { saleItemId, amount: n.toString() });
    return { amount: n };
  });
}
export async function refundDeposit(actor: Actor, receiptId: string, amountValue: string, reason: string) {
  requirePermission(actor, 'receipts');
  return transact(async tx => {
    const receipt = await tx.receipt.findFirst({ where: { id: receiptId, merchantId: actor.merchantId } });
    if (!receipt || !['DEPOSIT','ADVANCE'].includes(receipt.kind)) throw new AppError(404, '押金或预付款不存在');
    requireCustomerAccess(actor,receipt.partnerId);
    const n = positiveMoney(amountValue);
    if (receipt.allocatedCents + n > receipt.amountCents) throw new AppError(409, '退款超过剩余余额');
    const entry = await tx.moneyEntry.create({ data: { merchantId: actor.merchantId, partnerId: receipt.partnerId, kind: receipt.kind === 'DEPOSIT' ? 'DEPOSIT_REFUND' : 'ADVANCE_REFUND', amountCents: n, relatedType: 'RECEIPT', relatedId: receipt.id, note: asString(reason, '退款原因'), actorId: actor.id } });
    await tx.receipt.update({ where: { id: receipt.id }, data: { allocatedCents: { increment: n } } });
    await audit(tx, actor, 'REFUND', 'RECEIPT', receipt.id, null, { amount: n.toString(), entryId: entry.id }, reason);
    return entry;
  });
}
export async function createPayment(actor: Actor, input: any) {
  requirePermission(actor, 'payments');
  const amount = positiveMoney(input.amount);
  if (!Array.isArray(input.allocations) || !input.allocations.length) throw new AppError(400, '请选择上游应付明细');
  return transact(async tx => {
    const p = await partner(tx, actor, asString(input.ownerId, '上游货主'));
    let allocated = 0n;
    const checked: Array<{ payableId?: string; openingEntryId?: string; amount: bigint }> = [];
    for (const a of input.allocations) {
      if(a.openingEntryId){
        const opening=await tx.moneyEntry.findFirst({where:{id:a.openingEntryId,merchantId:actor.merchantId,partnerId:p.id,kind:'OPENING_AP'}});
        if(!opening)throw new AppError(404,'期初应付不存在');
        const n=positiveMoney(a.amount);
        if(opening.appliedCents+n>opening.amountCents||allocated+n>amount)throw new AppError(409,'付款核销超额');
        checked.push({openingEntryId:opening.id,amount:n});allocated+=n;continue;
      }
      const payable = await tx.payable.findFirst({ where: { id: a.payableId, merchantId: actor.merchantId, ownerId: p.id }, include: { saleItem: true } });
      if (!payable) throw new AppError(404, '上游应付不存在');
      if (payable.saleItem.paidCents < payable.saleItem.netCents - payable.saleItem.returnedCents) throw new AppError(409, '该件货的客户款尚未收齐，不能付给上游');
      const n = positiveMoney(a.amount);
      if (payable.paidCents + n > payable.amountCents + payable.adjustedCents || allocated + n > amount) throw new AppError(409, '付款核销超额');
      checked.push({ payableId: payable.id, amount: n }); allocated += n;
    }
    if (allocated !== amount) throw new AppError(400, '付款金额须全部对应上游应付明细');
    const payment = await tx.payment.create({ data: { merchantId: actor.merchantId, ownerId: p.id, amountCents: amount, method: asString(input.method || '线下', '付款方式'), note: input.note || null, actorId: actor.id } });
    for (const a of checked) {
      if(a.openingEntryId){await tx.moneyEntry.update({where:{id:a.openingEntryId},data:{appliedCents:{increment:a.amount}}});await tx.openingAllocation.create({data:{merchantId:actor.merchantId,moneyEntryId:a.openingEntryId,paymentId:payment.id,amountCents:a.amount}})}
      else {await tx.payable.update({ where: { id: a.payableId! }, data: { paidCents: { increment: a.amount } } });await tx.paymentAllocation.create({ data: { merchantId: actor.merchantId, paymentId: payment.id, payableId: a.payableId!, amountCents: a.amount } });}
    }
    await audit(tx, actor, 'PAYMENT', 'PAYMENT', payment.id, null, { amount: amount.toString(), allocations: checked });
    return payment;
  });
}
export async function returnSaleItem(actor: Actor, saleItemId: string, input: any) {
  requirePermission(actor, 'returns');
  return transact(async tx => {
    const item = await tx.saleItem.findFirst({ where: { id: saleItemId, merchantId: actor.merchantId, status: 'ACTIVE' }, include: { sale: true, payable: true } });
    if (!item) throw new AppError(409, '销售明细已退或不存在');
    requireCustomerAccess(actor,item.sale.customerId);
    const physical = input.physical !== false;
    const amount = input.amount ? positiveMoney(input.amount, '退货金额') : item.netCents;
    if (item.returnedCents + amount > item.netCents) throw new AppError(409, '退货金额超出成交金额');
    if (physical && item.returnedCents + amount !== item.netCents) throw new AppError(400, '单件实物退回须全额退货；部分金额请选仅改价或退款');
    const refund = input.refund ? money(input.refund, '实际退款') : 0n;
    if (refund > item.paidCents) throw new AppError(409, '实际退款超过已收金额');
    const g = await lockGood(tx, actor, item.goodId);
    const full = item.returnedCents + amount === item.netCents;
    const remainingSale = item.netCents - item.returnedCents - amount;
    const afterRefund = item.paidCents - refund;
    const refundDue = afterRefund > remainingSale ? afterRefund - remainingSale : 0n;
    await tx.saleItem.update({ where: { id: item.id }, data: { returnedCents: { increment: amount }, paidCents: afterRefund - refundDue, status: full ? physical ? 'RETURNED' : 'ADJUSTED' : 'ACTIVE' } });
    if (refund) await tx.moneyEntry.create({ data: { merchantId: actor.merchantId, partnerId: item.sale.customerId, kind: 'CUSTOMER_REFUND', amountCents: refund, relatedType: 'SALE_ITEM', relatedId: item.id, note: input.reason || null, actorId: actor.id } });
    if (refundDue) await tx.moneyEntry.create({ data: { merchantId: actor.merchantId, partnerId: item.sale.customerId, kind: 'CUSTOMER_REFUND_DUE', amountCents: refundDue, relatedType: 'SALE_ITEM', relatedId: item.id, note: input.reason || null, actorId: actor.id } });
    if (physical) {
      if (input.locationId) await location(tx, actor, input.locationId);
      await move(tx, actor, g, { occupancy: full ? 'FREE' : 'SOLD', holderKind: 'MERCHANT', holderPartnerId: null, currentOwnerKind: g.ownershipKind === 'CONSIGN' ? 'PARTNER' : 'MERCHANT', currentOwnerPartnerId: g.ownershipKind === 'CONSIGN' ? g.ownerPartnerId : null, locationId: input.locationId || null, quality: input.damaged ? 'HOLD' : 'NORMAL', custodianUserId: actor.id }, 'SALE_RETURN', 'SALE_ITEM', item.id, input.reason);
      if (input.damaged) await tx.damage.create({ data: { merchantId: actor.merchantId, goodId: g.id, description: asString(input.reason, '货损说明'), actorId: actor.id } });
    }
    if (item.payable) {
      // A final return clears the remaining payable exactly, including cents left by earlier partial adjustments.
      const reduction = full
        ? item.payable.amountCents + item.payable.adjustedCents
        : (item.payable.amountCents * amount + item.netCents / 2n) / item.netCents;
      const previousOverpaid = item.payable.paidCents > item.payable.amountCents + item.payable.adjustedCents
        ? item.payable.paidCents - item.payable.amountCents - item.payable.adjustedCents : 0n;
      await tx.payable.update({ where: { id: item.payable.id }, data: { adjustedCents: { decrement: reduction } } });
      const newBalance = item.payable.amountCents + item.payable.adjustedCents - reduction;
      const currentOverpaid = item.payable.paidCents > newBalance ? item.payable.paidCents - newBalance : 0n;
      const newlyOverpaid = currentOverpaid - previousOverpaid;
      if (newlyOverpaid>0n) {
        await tx.moneyEntry.create({ data: { merchantId: actor.merchantId, partnerId: item.payable.ownerId, kind: 'SUPPLIER_CREDIT_PENDING', amountCents: newlyOverpaid, relatedType: 'PAYABLE', relatedId: item.payable.id, note: input.reason || '已付款后退货，待老板确认追回或抵扣', actorId: actor.id } });
      }
    }
    await audit(tx, actor, physical ? 'SALE_RETURN' : 'PRICE_REFUND', 'SALE_ITEM', item.id, item, { amount: amount.toString(), refund: refund.toString(), physical }, input.reason);
    return { saleItemId, returned: amount, refunded: refund };
  });
}
export async function returnUpstream(actor: Actor, goodId: string, reason: string) {
  requirePermission(actor, 'stock');
  return transact(async tx => {
    const g = await lockGood(tx, actor, goodId);
    if (g.ownershipKind !== 'CONSIGN' || g.occupancy !== 'FREE' || g.holderKind !== 'MERCHANT') throw new AppError(409, '只有在手未成交的寄售货可以退上游');
    const result = await move(tx, actor, g, { holderKind: 'PARTNER', holderPartnerId: g.ownerPartnerId, locationId: null, returnedUpstreamAt: new Date() }, 'RETURN_UPSTREAM', 'GOOD', goodId, asString(reason, '原因'));
    await audit(tx, actor, 'RETURN_UPSTREAM', 'GOOD', goodId, state(g), state(result), reason);
    return result;
  });
}
export async function openingBalance(actor: Actor, input: any) {
  requirePermission(actor, 'finance');
  return transact(async tx => {
    const p = await partner(tx, actor, asString(input.partnerId, '合作方'));
    const kind = input.kind === 'AP' ? 'OPENING_AP' : 'OPENING_AR';
    const entry = await tx.moneyEntry.create({ data: { merchantId: actor.merchantId, partnerId: p.id, kind, amountCents: positiveMoney(input.amount), note: input.note || null, actorId: actor.id } });
    await audit(tx, actor, kind, 'MONEY_ENTRY', entry.id, null, entry);
    return entry;
  });
}
export async function settleSupplierCredit(actor: Actor, entryId: string, input:any){
  requirePermission(actor,'finance');
  return transact(async tx=>{
    const pending=await tx.moneyEntry.findFirst({where:{id:entryId,merchantId:actor.merchantId,kind:'SUPPLIER_CREDIT_PENDING'}});
    if(!pending)throw new AppError(404,'待处理上游调整不存在');
    const n=positiveMoney(input.amount);
    if(pending.appliedCents+n>pending.amountCents)throw new AppError(409,'处理金额超过待处理余额');
    const mode=input.mode==='OFFSET'?'OFFSET':'RECOVERY';
    if(mode==='OFFSET'){
      const payable=await tx.payable.findFirst({where:{id:input.payableId,merchantId:actor.merchantId,ownerId:pending.partnerId}});
      if(!payable||payable.amountCents+payable.adjustedCents-payable.paidCents<n)throw new AppError(409,'后续应付不足以抵扣');
      await tx.payable.update({where:{id:payable.id},data:{adjustedCents:{decrement:n}}});
    }
    await tx.moneyEntry.update({where:{id:pending.id},data:{appliedCents:{increment:n}}});
    const result=await tx.moneyEntry.create({data:{merchantId:actor.merchantId,partnerId:pending.partnerId,kind:mode==='OFFSET'?'SUPPLIER_CREDIT_OFFSET':'SUPPLIER_REFUND',amountCents:n,relatedType:'MONEY_ENTRY',relatedId:pending.id,note:asString(input.reason,'处理原因'),actorId:actor.id}});
    await audit(tx,actor,'SETTLE_SUPPLIER_CREDIT','MONEY_ENTRY',pending.id,pending,{mode,amount:n.toString(),resultId:result.id},input.reason);
    return result;
  });
}
export async function settleCustomerRefund(actor: Actor, entryId:string, amountValue:string, reason:string){
  requirePermission(actor,'returns');
  return transact(async tx=>{
    const due=await tx.moneyEntry.findFirst({where:{id:entryId,merchantId:actor.merchantId,kind:'CUSTOMER_REFUND_DUE'}});
    if(!due)throw new AppError(404,'待退客户款不存在');
    requireCustomerAccess(actor,due.partnerId);
    const n=positiveMoney(amountValue);
    if(due.appliedCents+n>due.amountCents)throw new AppError(409,'退款超过待退余额');
    await tx.moneyEntry.update({where:{id:due.id},data:{appliedCents:{increment:n}}});
    const result=await tx.moneyEntry.create({data:{merchantId:actor.merchantId,partnerId:due.partnerId,kind:'CUSTOMER_REFUND',amountCents:n,relatedType:'MONEY_ENTRY',relatedId:due.id,note:asString(reason,'退款原因'),actorId:actor.id}});
    await audit(tx,actor,'SETTLE_CUSTOMER_REFUND','MONEY_ENTRY',due.id,due,{amount:n.toString()},reason);
    return result;
  });
}
export async function reviewDamage(actor: Actor, damageId: string, input: any) {
  if (actor.role !== 'OWNER') throw new AppError(403, '货损责任和处置须由老板复核');
  const disposition = asString(input.disposition, '货损处置');
  if (!['KEEP_HOLD', 'RESTORE', 'WRITE_OFF'].includes(disposition)) throw new AppError(400, '货损处置方式无效');
  const responsibility = asString(input.responsibility, '责任归属');
  if (!['UNCONFIRMED', 'CUSTOMER', 'UPSTREAM', 'MERCHANT', 'OTHER'].includes(responsibility)) throw new AppError(400, '责任归属无效');
  const reason = asString(input.reason, '货损处置说明');
  return transact(async tx => {
    const damage = await tx.damage.findFirst({ where: { id: damageId, merchantId: actor.merchantId, resolvedAt: null } });
    if (!damage) throw new AppError(404, '待处理货损不存在');
    const good = await lockGood(tx, actor, damage.goodId);
    if (good.quality !== 'HOLD') throw new AppError(409, '货品当前不在待处理状态，请先核对库存');
    let imageId: string | null = null;
    if (input.imageId) {
      const image = await tx.goodImage.findFirst({ where: { id: String(input.imageId), merchantId: actor.merchantId, goodId: good.id } });
      if (!image) throw new AppError(404, '货损凭证照片不存在');
      imageId = image.id;
    }
    if (disposition === 'KEEP_HOLD') {
      const result = await tx.damage.update({ where: { id: damage.id }, data: { responsibility, resolution: `继续待处理：${reason}`, ...(imageId ? { photoFile: imageId } : {}) } });
      await audit(tx, actor, 'REVIEW_PENDING', 'DAMAGE', damage.id, damage, result, reason);
      return { id: result.id, status: 'OPEN', quality: good.quality };
    }
    if (good.holderKind !== 'MERCHANT' || good.occupancy !== 'FREE' || good.returnedUpstreamAt) throw new AppError(409, '货品当前不在摊位，不能结案');
    const open = await tx.damage.findMany({ where: { merchantId: actor.merchantId, goodId: good.id, resolvedAt: null } });
    const quality = disposition === 'RESTORE' ? 'NORMAL' : 'DAMAGED';
    await move(tx, actor, good, { quality }, disposition === 'RESTORE' ? 'DAMAGE_RESTORED' : 'DAMAGE_WRITE_OFF', 'DAMAGE', damage.id, reason);
    await tx.damage.updateMany({ where: { merchantId: actor.merchantId, goodId: good.id, resolvedAt: null }, data: { responsibility, resolution: `${disposition}：${reason}`, ...(imageId ? { photoFile: imageId } : {}), resolvedAt: new Date() } });
    await audit(tx, actor, 'RESOLVE', 'DAMAGE', damage.id, open, { disposition, responsibility, quality, count: open.length, imageId }, reason);
    return { id: damage.id, status: 'RESOLVED', quality, resolved: open.length };
  });
}
export async function createStocktake(actor: Actor, locationId: string) {
  requirePermission(actor, 'stock');
  return transact(async tx => {
    await location(tx, actor, locationId);
    const goods = await tx.good.findMany({ where: { merchantId: actor.merchantId, locationId, holderKind: 'MERCHANT', returnedUpstreamAt: null } });
    const take = await tx.stocktake.create({ data: { merchantId: actor.merchantId, locationId, actorId: actor.id, items: { create: goods.map(g => ({ merchantId: actor.merchantId, goodId: g.id, expectedVersion: g.version })) } }, include: { items: true } });
    await audit(tx, actor, 'CREATE', 'STOCKTAKE', take.id, null, { count: goods.length });
    return take;
  });
}
export async function markStocktake(actor: Actor, takeId: string, code: string) {
  requirePermission(actor, 'stock');
  const stockCode = asString(code, '货号');
  if (stockCode.length > 80) throw new AppError(400, '货号不能超过80个字符');
  return transact(async tx => {
    const take = await tx.stocktake.findFirst({ where: { id: takeId, merchantId: actor.merchantId, status: 'OPEN' } });
    if (!take) throw new AppError(404, '盘点不存在或已结束');
    const good = await tx.good.findFirst({ where: { merchantId: actor.merchantId, code: stockCode } });
    const item = good ? await tx.stocktakeItem.findUnique({ where: { stocktakeId_goodId: { stocktakeId: take.id, goodId: good.id } } }) : null;
    if (!item) {
      const kind = !good ? 'UNREGISTERED' : good.holderKind === 'MERCHANT' && good.locationId !== take.locationId ? 'WRONG_LOCATION' : 'EXTRA';
      await tx.stocktakeFinding.upsert({
        where: { stocktakeId_code: { stocktakeId: take.id, code: stockCode } },
        create: { merchantId: actor.merchantId, stocktakeId: take.id, code: stockCode, goodId: good?.id, kind },
        update: { goodId: good?.id || null, kind, status: 'OPEN', resolution: null, reviewedById: null, resolvedAt: null },
      });
      return { kind, code: stockCode };
    }
    if (!good) throw new AppError(404, '货号不存在');
    const changed = good.version !== item.expectedVersion;
    const movedOut = good.locationId !== take.locationId || good.holderKind !== 'MERCHANT' || good.returnedUpstreamAt !== null;
    await tx.stocktakeItem.update({ where: { id: item.id }, data: {
      seen: true,
      expectedVersion: good.version,
      note: movedOut ? '流转后已移出本盘点位置' : changed ? '流转后已重新核对' : item.note,
    } });
    return { kind: movedOut ? 'MOVED_OUT' : changed ? 'RECHECK' : 'SEEN', code: stockCode };
  });
}
export async function resolveStocktakeFinding(actor: Actor, findingId: string, disposition: string, reason: string) {
  requirePermission(actor, 'stockApprove');
  if (!['MOVE_HERE', 'IGNORE'].includes(disposition)) throw new AppError(400, '盘点差异处理方式无效');
  const reviewReason = asString(reason, '盘点差异处置说明');
  return transact(async tx => {
    const finding = await tx.stocktakeFinding.findFirst({ where: { id: findingId, merchantId: actor.merchantId, status: 'OPEN' }, include: { stocktake: true } });
    if (!finding || finding.stocktake.status !== 'OPEN') throw new AppError(404, '待复核差异不存在');
    let good: Good | null = null;
    if (disposition === 'MOVE_HERE') {
      const known = await tx.good.findFirst({ where: { merchantId: actor.merchantId, code: finding.code } });
      if (!known) throw new AppError(409, '请先录入这件货，再选择移入盘点位置');
      good = await lockGood(tx, actor, known.id);
      if (good.holderKind !== 'MERCHANT' || good.occupancy !== 'FREE' || good.returnedUpstreamAt) throw new AppError(409, '这件货当前不能移入盘点位置');
      if (good.locationId !== finding.stocktake.locationId) {
        good = await move(tx, actor, good, { locationId: finding.stocktake.locationId, custodianUserId: actor.id }, 'STOCKTAKE_EXTRA_MOVE', 'STOCKTAKE', finding.stocktakeId, reviewReason);
      }
      await tx.stocktakeItem.upsert({
        where: { stocktakeId_goodId: { stocktakeId: finding.stocktakeId, goodId: good.id } },
        create: { merchantId: actor.merchantId, stocktakeId: finding.stocktakeId, goodId: good.id, expectedVersion: good.version, seen: true, note: '差异复核后移入' },
        update: { expectedVersion: good.version, seen: true, note: '差异复核后移入' },
      });
    }
    const result = await tx.stocktakeFinding.update({ where: { id: finding.id }, data: { status: 'RESOLVED', goodId: good?.id || finding.goodId, resolution: `${disposition}：${reviewReason}`, reviewedById: actor.id, resolvedAt: new Date() } });
    await audit(tx, actor, 'RESOLVE_FINDING', 'STOCKTAKE', finding.stocktakeId, finding, result, reviewReason);
    return result;
  });
}
export async function closeStocktake(actor: Actor, takeId: string, reason: string) {
  requirePermission(actor, 'stockApprove');
  const reviewReason = asString(reason, '盘点复核说明');
  return transact(async tx => {
    const take = await tx.stocktake.findFirst({ where: { id: takeId, merchantId: actor.merchantId, status: 'OPEN' }, include: { items: true, findings: true } });
    if (!take) throw new AppError(404, '盘点不存在或已结束');
    if (take.findings.some(f => f.status === 'OPEN')) throw new AppError(409, '存在未复核的多货或错位差异，须逐项处理后结束盘点');
    const changed = [];
    for (const item of take.items) {
      const g = await lockGood(tx, actor, item.goodId);
      if (g.version !== item.expectedVersion) changed.push(g.code);
    }
    if (changed.length) throw new AppError(409, `以下货品盘点期间发生流转，须重新核对：${changed.join('、')}`);
    const missing = take.items.filter(i => !i.seen);
    for (const item of missing) {
      const g = await lockGood(tx, actor, item.goodId);
      await move(tx, actor, g, { quality: 'HOLD' }, 'STOCKTAKE_MISSING', 'STOCKTAKE', take.id, reviewReason);
      if (!await tx.damage.findFirst({ where: { merchantId: actor.merchantId, goodId: g.id, resolvedAt: null } })) {
        await tx.damage.create({ data: { merchantId: actor.merchantId, goodId: g.id, description: `盘点未见：${reviewReason}`, actorId: actor.id } });
      }
    }
    await tx.stocktake.update({ where: { id: take.id }, data: { status: 'CLOSED', reviewedById: actor.id, closedAt: new Date() } });
    await audit(tx, actor, 'CLOSE', 'STOCKTAKE', take.id, null, { missing: missing.map(i => i.goodId) }, reviewReason);
    return { missing: missing.length };
  });
}
