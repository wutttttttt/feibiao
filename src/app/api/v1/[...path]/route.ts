import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { AppError, allowed, canAccessPartner, customerIds, clearSession, createSession, currentUser, issueMiniToken, requirePermission, type Actor } from '@/lib/auth';
import { hash, serialize, token, asString, money, json } from '@/lib/common';
import { recordFailure, checkLocked, recordSuccess } from '@/lib/login-guard';
import * as b from '@/lib/business';
import { requestKey } from '@/lib/request-key';
import { existsSync } from 'node:fs';

type Ctx = { params: Promise<{ path: string[] }> };
function response(value: unknown, status = 200) { return NextResponse.json(serialize(value), { status }); }
function error(e: unknown) {
  if (e instanceof AppError) return response({ error: e.message }, e.status);
  if ((e as any)?.code === 'P2002') return response({ error: '货号、外部编号或单据已存在' }, 409);
  if ((e as any)?.code === 'P2034') return response({ error: '其他人正在操作同一笔业务，请刷新后重试' }, 409);
  console.error(e);
  return response({ error: '操作失败，已回滚，请稍后重试' }, 500);
}
function visibleGood(actor: Actor, g: any) {
  const { costCents, floorCents, settlementType, settlementFixedCents, settlementRateBp, ruleVersion, ownerPartnerId, holderPartnerId, currentOwnerPartnerId, sourcePartnerId, movements, ...rest } = g;
  const safeMovements=movements?.map((m:any)=>({id:m.id,action:m.action,createdAt:m.createdAt,reason:m.reason}));
  if(actor.role==='OWNER')return g;
  const safe={...rest,...(movements===undefined?{}:{movements:safeMovements})};
  return allowed(actor,'cost')?{...safe,costCents,floorCents,settlementType,settlementFixedCents,settlementRateBp,ruleVersion}:safe;
}
async function staffPermissions(value: unknown, tenant: string) {
  const raw=(value&&typeof value==='object'&&!Array.isArray(value)?value:{}) as Record<string,unknown>;
  const ids=Array.isArray(raw.customerIds)?[...new Set(raw.customerIds.filter((v):v is string=>typeof v==='string'))]:[];
  if(ids.length){const count=await db.partner.count({where:{merchantId:tenant,id:{in:ids},roles:{has:'CUSTOMER'}}});if(count!==ids.length)throw new AppError(400,'授权客户不属于当前摊位');}
  return json({...raw,customerIds:ids});
}
async function run(req: NextRequest, ctx: Ctx) {
  const path = (await ctx.params).path;
  const action = path.join('/');
  if (req.method === 'POST' && action === 'login') {
    const body = await req.json();
    const loginId = asString(body.login, '账号');
    const lockState = checkLocked(loginId);
    if (lockState.locked) { const mins = Math.ceil((lockState.retryAfterSec || 60) / 60); throw new AppError(429, `账号已锁定，请 ${mins} 分钟后再试`); }
    const user = await db.user.findUnique({ where: { login: loginId } });
    const passwordOk = user?.active ? await bcrypt.compare(String(body.password || ''), user.passwordHash) : (await bcrypt.compare(String(body.password || ''), '$2b$12$abcdefghijklmnopqrstuv1234567890abcdefghijklmnopqrst'), false);
    if (!user?.active || !passwordOk) {
      recordFailure(loginId);
      try { await db.auditLog.create({ data: { merchantId: user?.merchantId || 'unknown', actorId: 'system', action: 'LOGIN_FAILED', entityType: 'USER', entityId: user?.id || loginId } }); } catch {}
      throw new AppError(401, '账号或密码错误');
    }
    recordSuccess(loginId);
    try { await db.auditLog.create({ data: { merchantId: user.merchantId, actorId: user.id, action: 'LOGIN_SUCCESS', entityType: 'USER', entityId: user.id } }); } catch {}
    await createSession(user.id);
    const mini = req.headers.get('x-client') === 'wechat-mini';
    return response({ name: user.name, role: user.role, ...(mini ? { token: await issueMiniToken(user.id), expiresIn: 43200 } : {}) });
  }
  if (req.method === 'POST' && action === 'logout') { await clearSession(); return response({ ok: true }); }
  const actor = await currentUser();
  if (!actor) throw new AppError(401, '请先登录');
  const tenant = actor.merchantId;
  const assignedCustomers = customerIds(actor);
  const q = req.nextUrl.searchParams;
  if (req.method === 'GET') {
    if (action === 'me') return response({ id: actor.id, name: actor.name, role: actor.role, permissions: actor.permissions });
    if (action === 'dashboard') {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
      const todayStart = new Date(`${today}T00:00:00+08:00`);
      const [goods, loans, intakes, sales, receipts, payables, damages, entries, overdue, intakeOverdue] = await Promise.all([
        db.good.findMany({ where: { merchantId: tenant }, select: { holderKind: true, occupancy: true, quality: true, returnedUpstreamAt: true, createdAt: true } }),
        db.loanItem.count({ where: { merchantId: tenant, status: 'OUT', loan:assignedCustomers===null?undefined:{partnerId:{in:assignedCustomers}} } }),
        db.intakeItem.count({ where: { merchantId: tenant, status: { in: ['PENDING','ACTIVE'] } } }),
        db.saleItem.findMany({ where: { merchantId: tenant, status: 'ACTIVE', sale: assignedCustomers===null?undefined:{customerId:{in:assignedCustomers}} }, select: { netCents: true, returnedCents: true, paidCents: true, createdAt: true, good:{select:{ownershipKind:true,costCents:true}},payable:{select:{amountCents:true,adjustedCents:true}} } }),
        db.receipt.findMany({ where: { merchantId: tenant, partnerId: assignedCustomers===null?undefined:{in:assignedCustomers} }, select: { amountCents: true, receivedAt: true } }),
        db.payable.findMany({ where: { merchantId: tenant, saleItem:assignedCustomers===null?undefined:{sale:{customerId:{in:assignedCustomers}}} }, select: { amountCents: true, adjustedCents: true, paidCents: true } }),
        db.damage.count({ where: { merchantId: tenant, resolvedAt: null } }),
        db.moneyEntry.findMany({where:{merchantId:tenant,partnerId:assignedCustomers===null?undefined:{in:assignedCustomers}},select:{kind:true,amountCents:true,appliedCents:true,createdAt:true}}),
        db.loanItem.count({where:{merchantId:tenant,status:'OUT',loan:{dueAt:{lt:todayStart},partnerId:assignedCustomers===null?undefined:{in:assignedCustomers}}}}),
        db.intakeItem.count({where:{merchantId:tenant,status:{in:['PENDING','ACTIVE']},intake:{dueAt:{lt:todayStart}}}})
      ]);
      const month = today.slice(0,7);
      const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
      const sum = (v: bigint[]) => v.reduce((a,c) => a+c,0n);
      const refunds=sum(entries.filter(e=>['CUSTOMER_REFUND','DEPOSIT_REFUND','ADVANCE_REFUND'].includes(e.kind)&&day(e.createdAt).startsWith(month)).map(e=>e.amountCents));
      const nonnegative=(v:bigint)=>v>0n?v:0n;
      const monthItems=sales.filter(s=>day(s.createdAt).startsWith(month));
      const feeRows=await db.saleFee.findMany({where:{merchantId:tenant,createdAt:{gte:new Date(`${month}-01T00:00:00+08:00`)}}});
      const profitIncomplete=monthItems.some(s=>s.good.ownershipKind==='OWN'&&s.good.costCents==null||s.good.ownershipKind==='CONSIGN'&&!s.payable);
      const profit=sum(monthItems.map(s=>s.netCents-s.returnedCents-(s.good.ownershipKind==='OWN'?(s.good.costCents||0n):(s.payable?.amountCents||0n)+(s.payable?.adjustedCents||0n))))-sum(feeRows.map(f=>f.amountCents));
      const result = { inHand: goods.filter(g => g.holderKind === 'MERCHANT' && g.occupancy === 'FREE' && g.quality === 'NORMAL' && !g.returnedUpstreamAt).length, onLoan: loans, intakeOpen: intakes, overdue, intakeOverdue, todaySales: sum(sales.filter(s => day(s.createdAt) === today).map(s => s.netCents-s.returnedCents)), monthSales: sum(monthItems.map(s => s.netCents-s.returnedCents)), received: sum(receipts.filter(r => day(r.receivedAt).startsWith(month)).map(r => r.amountCents))-refunds, customerUnpaid: allowed(actor,'financeRead') ? sum(sales.map(s => nonnegative(s.netCents-s.returnedCents-s.paidCents)))+sum(entries.filter(e=>e.kind==='OPENING_AR').map(e=>e.amountCents-e.appliedCents)) : null, supplierUnpaid: allowed(actor,'financeRead') ? sum(payables.map(p => nonnegative(p.amountCents+p.adjustedCents-p.paidCents)))+sum(entries.filter(e=>e.kind==='OPENING_AP').map(e=>e.amountCents-e.appliedCents)) : null, profit:allowed(actor,'cost')&&allowed(actor,'financeRead')&&!profitIncomplete?profit:null, profitIncomplete:allowed(actor,'cost')&&allowed(actor,'financeRead')?profitIncomplete:null, damages, stale: goods.filter(g => g.occupancy === 'FREE' && g.createdAt < new Date(Date.now()-90*86400000)).length };
      return response(result);
    }
    if (action === 'partners') { requirePermission(actor, 'partnersRead'); const rows=await db.partner.findMany({ where: { merchantId: tenant, archivedAt: null, name: q.get('q') ? { contains: q.get('q')! } : undefined, OR:assignedCustomers===null?undefined:[{NOT:{roles:{has:'CUSTOMER'}}},{id:{in:assignedCustomers}}] }, orderBy: { createdAt: 'desc' }, take: 200 }); return response(rows.map(p=>allowed(actor,'cost')?p:(({settlementFixedCents,settlementRateBp,settlementType,...safe})=>safe)(p))); }
    if (path[0] === 'partners' && path[1] && path.length === 2) {
      requirePermission(actor, 'partnersRead');
      if (!allowed(actor,'financeRead')) { const p=await db.partner.findFirst({where:{id:path[1],merchantId:tenant},select:{id:true,name:true,phone:true,roles:true,note:true}});if(!p||!canAccessPartner(actor,p))throw new AppError(404,'合作方不存在');return response(p); }
      const p = await db.partner.findFirst({ where: { id: path[1], merchantId: tenant }, include: { loans: { include: { items: true } }, sales: { include: { items: true } }, receipts: true, payables: true, payments: true, moneyEntries: true } });
      if (!p||!canAccessPartner(actor,p)) throw new AppError(404, '合作方不存在');
      if (!allowed(actor,'cost')) { const { settlementType, settlementFixedCents, settlementRateBp, ruleVersion, ...safe } = p; return response(safe); }
      return response(p);
    }
    if (action === 'locations') return response(await db.location.findMany({ where: { merchantId: tenant, active: true }, orderBy: { name: 'asc' } }));
    if (action === 'goods') {
      const where: any = { merchantId: tenant, code: q.get('code') ? { contains: q.get('code')! } : undefined, category: q.get('category') || undefined, occupancy: q.get('occupancy') || undefined, ownerPartnerId: q.get('ownerId') || undefined, holderPartnerId: q.get('holderId') || undefined, locationId: q.get('locationId') || undefined };
      const goods = await db.good.findMany({ where, include: { images: true }, orderBy: { createdAt: 'desc' }, take: 300 });
      return response(goods.map(g => visibleGood(actor, g)));
    }
    if (path[0] === 'goods' && path[1] && path.length === 2) {
      const g = await db.good.findFirst({ where: { id: path[1], merchantId: tenant }, include: { images: true, movements: { orderBy: { createdAt: 'desc' }, take: 100 } } });
      if (!g) throw new AppError(404, '货品不存在'); return response(visibleGood(actor, g));
    }
    if (action === 'loans') { requirePermission(actor, 'loans'); return response(await db.loan.findMany({ where: { merchantId: tenant,partnerId:assignedCustomers===null?undefined:{in:assignedCustomers} }, include: { partner: {select:{id:true,name:true}}, items: { select:{id:true,status:true,referencePriceCents:true,agreedSettlementCents:true,good:{select:{id:true,code:true,name:true,quality:true}}} } }, orderBy: { createdAt: 'desc' }, take: 100 })); }
    if (action === 'intakes') {
      requirePermission(actor, 'loans');
      const rows = await db.intake.findMany({ where: { merchantId: tenant }, include: { partner: { select: { id: true, name: true } }, location: { select: { id: true, name: true } }, items: { orderBy: { lineNo: 'asc' }, include: { good: { include: { images: true, damage: { where: { resolvedAt: null }, select: { id: true } } } } } } }, orderBy: { createdAt: 'desc' }, take: 100 });
      const canCost = allowed(actor, 'cost');
      return response(rows.map(row => ({ ...row, overdue: ['RECEIVING','ACTIVE'].includes(row.status) && row.dueAt < new Date(`${new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})}T00:00:00+08:00`), items: row.items.map(({declaredCents,...item}) => { const {damage,...good}=item.good; const returnBlockedReason=item.status!=='ACTIVE'?null:damage.length?'有未处理货损':good.occupancy==='LOAN'||good.holderKind!=='MERCHANT'?'客户持有':good.occupancy!=='FREE'?'当前状态不可退':good.returnedUpstreamAt?'已退上游':null; return { ...item, ...(canCost ? { declaredCents } : {}), returnBlockedReason, good: visibleGood(actor, good) }; }) })));
    }
    if (action === 'sales') { requirePermission(actor, 'sales'); return response(await db.sale.findMany({ where: { merchantId: tenant,customerId:assignedCustomers===null?undefined:{in:assignedCustomers} }, include: { customer: { select: { id: true, name: true } }, items: { include: { good: { select: { code: true, name: true } } } }, fees:allowed(actor,'cost') }, orderBy: { createdAt: 'desc' }, take: 100 })); }
    if (action === 'receipts') { requirePermission(actor, 'receipts'); return response(await db.receipt.findMany({ where: { merchantId: tenant,partnerId:assignedCustomers===null?undefined:{in:assignedCustomers} }, include: { partner: { select: { name: true } }, allocations: true }, orderBy: { receivedAt: 'desc' }, take: 100 })); }
    if(action==='money-entries'){requirePermission(actor,'financeRead');return response(await db.moneyEntry.findMany({where:{merchantId:tenant,partnerId:assignedCustomers===null?undefined:{in:assignedCustomers}},include:{partner:{select:{id:true,name:true}}},orderBy:{createdAt:'desc'},take:300}));}
    if (action === 'payables') { requirePermission(actor, 'payments'); return response(await db.payable.findMany({ where: { merchantId: tenant,saleItem:assignedCustomers===null?undefined:{sale:{customerId:{in:assignedCustomers}}} }, include: { owner: { select: { name: true } }, saleItem: { include: { good: { select: { code: true, name: true } } } } }, orderBy: { createdAt: 'desc' }, take: 200 })); }
    if (action === 'stocktakes') { requirePermission(actor, 'stock'); return response(await db.stocktake.findMany({ where: { merchantId: tenant }, include: { items: true, findings: true }, orderBy: { createdAt: 'desc' }, take: 50 })); }
    if (action === 'damages') { if (!allowed(actor, 'stock') && !allowed(actor, 'returns')) throw new AppError(403, '没有查看异常货的权限'); return response(await db.damage.findMany({ where: { merchantId: tenant }, include: { good: { select: { id: true, code: true, name: true } } }, orderBy: { discoveredAt: 'desc' }, take: 100 })); }
    if (action === 'audit') { requirePermission(actor, 'audit'); return response(await db.auditLog.findMany({ where: { merchantId: tenant }, orderBy: { createdAt: 'desc' }, take: 200 })); }
    if (action === 'users') { requirePermission(actor, 'settings'); return response(await db.user.findMany({where:{merchantId:tenant},select:{id:true,login:true,name:true,role:true,permissions:true,active:true},orderBy:{createdAt:'asc'}})); }
    if (action === 'shares') { requirePermission(actor,'shares'); return response(await db.shareLink.findMany({where:{merchantId:tenant,OR:assignedCustomers===null?undefined:[{kind:'GOOD'},{targetId:{in:assignedCustomers}}]},select:{id:true,kind:true,targetId:true,expiresAt:true,revokedAt:true,createdAt:true},orderBy:{createdAt:'desc'},take:100})); }
    throw new AppError(404, '接口不存在');
  }
  if (req.method !== 'POST') throw new AppError(405, '不支持的操作');
  if (existsSync('.runtime/maintenance')) throw new AppError(503,'正在备份数据，请稍后再操作');
  const body = await req.json();
  const idempotency = req.headers.get('idempotency-key');
  if (idempotency) {
    const prior = await db.idempotencyKey.findUnique({ where: { merchantId_actorId_key: { merchantId: tenant, actorId: actor.id, key: idempotency } } });
    if (prior) { if (prior.action !== action) throw new AppError(409, '请求编号已经用于其他操作'); return response(prior.result); }
    requestKey.enterWith({ merchantId: tenant, actorId: actor.id, key: idempotency, action });
  }
  let result: unknown;
  if (action === 'me/password') {
    const oldPassword = asString(body.oldPassword, '当前密码');
    const newPassword = asString(body.newPassword, '新密码');
    if (newPassword.length < 12) throw new AppError(400, '新密码至少12位');
    const fullUser = await db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { id: true, passwordHash: true, tokenVersion: true } });
    if (!(await bcrypt.compare(oldPassword, fullUser.passwordHash))) throw new AppError(401, '当前密码错误');
    await db.$transaction(async tx => {
      await tx.user.update({ where: { id: actor.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12), tokenVersion: { increment: 1 } } });
      await tx.auditLog.create({ data: { merchantId: tenant, actorId: actor.id, action: 'PASSWORD_CHANGED', entityType: 'USER', entityId: actor.id } });
    });
    await clearSession();
    return response({ ok: true });
  }
  if (action === 'partners') result = await b.createPartner(actor, body);
  else if (path[0] === 'partners' && path[2] === 'update') result = await b.updatePartner(actor, path[1], body);
  else if (action === 'locations') { requirePermission(actor, 'settings'); result = await db.location.create({ data: { merchantId: tenant, name: asString(body.name, '位置名称') } }); }
  else if (action === 'users') { requirePermission(actor,'settings'); const password=asString(body.password,'初始密码'); if(password.length<12)throw new AppError(400,'初始密码至少12位'); const permissions=await staffPermissions(body.permissions,tenant); result=await db.user.create({data:{merchantId:tenant,login:asString(body.login,'账号'),name:asString(body.name,'姓名'),passwordHash:await bcrypt.hash(password,12),role:'STAFF',permissions}}); result={id:(result as any).id,login:(result as any).login}; }
  else if (path[0]==='users'&&path[2]==='permissions') { requirePermission(actor,'settings'); const permissions=await staffPermissions(body.permissions,tenant); result=await db.$transaction(async tx=>{const target=await tx.user.findFirst({where:{id:path[1],merchantId:tenant,role:'STAFF'}});if(!target)throw new AppError(404,'员工不存在');const changed=await tx.user.update({where:{id:target.id},data:{permissions,active:body.active!==false},select:{id:true,name:true,permissions:true,active:true}});await tx.auditLog.create({data:{merchantId:tenant,actorId:actor.id,action:'PERMISSIONS',entityType:'USER',entityId:target.id,before:json({permissions:target.permissions,active:target.active}),after:json(changed)}});return changed}); }
  else if (action === 'goods') result = await b.createGood(actor, body);
  else if (path[0] === 'goods' && path[2] === 'update') result = await b.updateGood(actor, path[1], body);
  else if (path[0] === 'goods' && path[2] === 'move') result = await b.moveLocation(actor, path[1], body.locationId, body.reason);
  else if (path[0] === 'goods' && path[2] === 'reserve') result = await b.reserveGood(actor, path[1], true);
  else if (path[0] === 'goods' && path[2] === 'unreserve') result = await b.reserveGood(actor, path[1], false);
  else if (path[0] === 'goods' && path[2] === 'return-upstream') result = await b.returnUpstream(actor, path[1], body.reason);
  else if (action === 'loans') result = await b.createLoan(actor, body);
  else if (action === 'intakes') result = await b.createIntake(actor, body);
  else if (path[0] === 'intake-items' && path[2] === 'check-in') result = await b.checkInIntakeItem(actor, path[1], body);
  else if (path[0] === 'intakes' && path[2] === 'return') result = await b.returnIntakeItems(actor, path[1], body);
  else if (path[0] === 'loan-items' && path[2] === 'return') result = await b.returnLoanItem(actor, path[1], body);
  else if (path[0] === 'loan-items' && path[2] === 'transfer') result = await b.transferLoanItem(actor, path[1], body);
  else if (action === 'sales') result = await b.createSale(actor, body);
  else if(path[0]==='sales'&&path[2]==='fees')result=await b.addSaleFee(actor,path[1],body);
  else if (path[0] === 'sale-items' && path[2] === 'deliver') result = await b.deliverSaleItem(actor, path[1]);
  else if (path[0] === 'sale-items' && path[2] === 'return') result = await b.returnSaleItem(actor, path[1], body);
  else if (action === 'receipts') result = await b.createReceipt(actor, body);
  else if (path[0] === 'receipts' && path[2] === 'allocate') result = await b.allocateReceipt(actor, path[1], body.allocations);
  else if (path[0] === 'receipts' && path[2] === 'allocate-opening') result = await b.allocateOpeningReceipt(actor, path[1], body.entryId, body.amount);
  else if (path[0] === 'receipts' && path[2] === 'apply') result = await b.applyDeposit(actor, path[1], body.saleItemId, body.amount);
  else if (path[0] === 'receipts' && path[2] === 'refund') result = await b.refundDeposit(actor, path[1], body.amount, body.reason);
  else if (action === 'payments') result = await b.createPayment(actor, body);
  else if (action === 'opening-balances') result = await b.openingBalance(actor, body);
  else if(path[0]==='money-entries'&&path[2]==='settle-supplier')result=await b.settleSupplierCredit(actor,path[1],body);
  else if(path[0]==='money-entries'&&path[2]==='settle-customer')result=await b.settleCustomerRefund(actor,path[1],body.amount,body.reason);
  else if (action === 'stocktakes') result = await b.createStocktake(actor, body.locationId);
  else if (path[0] === 'stocktakes' && path[2] === 'scan') result = await b.markStocktake(actor, path[1], body.code);
  else if (path[0] === 'stocktake-findings' && path[2] === 'resolve') result = await b.resolveStocktakeFinding(actor, path[1], body.disposition, body.reason);
  else if (path[0] === 'stocktakes' && path[2] === 'close') result = await b.closeStocktake(actor, path[1], body.reason);
  else if (path[0] === 'damages' && path[2] === 'review') result = await b.reviewDamage(actor, path[1], body);
  else if (action === 'shares') {
    requirePermission(actor, 'shares');
    if (!['GOOD','LOAN','CUSTOMER_STATEMENT','OWNER_STATEMENT'].includes(body.kind)) throw new AppError(400, '分享类型无效');
    if (body.kind==='GOOD' ? !await db.good.findFirst({where:{id:body.targetId,merchantId:tenant}}) : !await db.partner.findFirst({where:{id:body.targetId,merchantId:tenant}})) throw new AppError(404,'分享对象不存在');
    if(body.kind!=='GOOD'){const target=await db.partner.findFirstOrThrow({where:{id:body.targetId,merchantId:tenant}});if(!canAccessPartner(actor,target))throw new AppError(404,'分享对象不存在')}
    const raw = token();
    const expires = new Date(Date.now() + Math.min(Math.max(Number(body.days) || 7, 1), 30)*86400000);
    const pin = body.kind === 'GOOD' ? null : asString(body.pin, '账单访问码');
    if(pin&&!/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/.test(pin))throw new AppError(400,'账单访问码至少8位且须含字母和数字');
    const link = await db.shareLink.create({ data: { merchantId: tenant, kind: body.kind, targetId: asString(body.targetId, '分享对象'), tokenHash: hash(raw), pinHash: pin ? await bcrypt.hash(pin, 12) : null, expiresAt: expires, createdById: actor.id } });
    result = { id: link.id, url: `${req.nextUrl.origin}/share/${raw}`, expiresAt: expires };
  }
  else if (path[0] === 'shares' && path[2] === 'revoke') { requirePermission(actor, 'shares'); result = await db.shareLink.updateMany({ where: { id: path[1], merchantId: tenant,OR:assignedCustomers===null?undefined:[{kind:'GOOD'},{targetId:{in:assignedCustomers}}] }, data: { revokedAt: new Date() } }); }
  else throw new AppError(404, '接口不存在');
  if (idempotency && !(await db.idempotencyKey.findUnique({ where: { merchantId_actorId_key: { merchantId: tenant, actorId: actor.id, key: idempotency } } }))) await db.idempotencyKey.create({ data: { merchantId: tenant, actorId: actor.id, key: idempotency, action, result: json(serialize(result)) } });
  return response(result, 200);
}
export async function GET(req: NextRequest, ctx: Ctx) { try { return await run(req, ctx); } catch (e) { return error(e); } }
export async function POST(req: NextRequest, ctx: Ctx) { try { return await run(req, ctx); } catch (e) { const key=requestKey.getStore(); if(key){const prior=await db.idempotencyKey.findUnique({where:{merchantId_actorId_key:{merchantId:key.merchantId,actorId:key.actorId,key:key.key}}});if(prior&&prior.action===key.action)return response(prior.result);} return error(e); } }
