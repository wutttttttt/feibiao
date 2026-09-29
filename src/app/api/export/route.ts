import { NextRequest,NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { allowed,canAccessPartner,customerIds,currentUser } from '@/lib/auth';
import { yuan } from '@/lib/common';
function cell(v:unknown){const value=String(v??'');const safe=/^[=+@\-]/.test(value)?`'${value}`:value;return `"${safe.replaceAll('"','""')}"`}
function csv(rows:unknown[][],name:string){return new NextResponse('\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${name}.csv"`,'Cache-Control':'private, no-store'}})}
export async function GET(req:NextRequest){const actor=await currentUser();if(!actor)return new NextResponse(null,{status:401});const kind=req.nextUrl.searchParams.get('kind');const merchantId=actor.merchantId;
  const assignedCustomers=customerIds(actor);
  if(kind==='goods'){
    if(!allowed(actor,'goods'))return new NextResponse(null,{status:403});
    const data=await db.good.findMany({where:{merchantId},orderBy:{code:'asc'}});
    const cost=allowed(actor,'cost');const rows=[['货号','名称','品类','货权类型','原货主','当前持有方','存放位置','品质','占用状态','报价',...(cost?['采购成本','底价']:[])],...data.map(g=>[g.code,g.name,g.category,g.ownershipKind,g.ownerPartnerId,g.holderPartnerId||g.holderKind,g.locationId,g.quality,g.occupancy,yuan(g.askingCents),...(cost?[yuan(g.costCents),yuan(g.floorCents)]:[])])];return csv(rows,'goods');
  }
  if(kind==='loans'){
    if(!allowed(actor,'loans'))return new NextResponse(null,{status:403});const data=await db.loanItem.findMany({where:{merchantId,loan:assignedCustomers===null?undefined:{partnerId:{in:assignedCustomers}}},include:{good:true,loan:{include:{partner:true}}}});return csv([['拿货单','客户','货号','货品','状态','拿货时间','应还时间'],...data.map(i=>[i.loan.number,i.loan.partner.name,i.good.code,i.good.name,i.status,i.handedAt.toISOString(),i.loan.dueAt?.toISOString()])],'loans');
  }
  if(kind==='intakes'){
    if(!allowed(actor,'loans'))return new NextResponse(null,{status:403});const data=await db.intakeItem.findMany({where:{merchantId},include:{good:true,intake:{include:{partner:true}}},orderBy:{createdAt:'desc'}});return csv([['收货单','上游货主','货号','货品','状态','收货时间','应还时间','核对时间','退还时间'],...data.map(i=>[i.intake.number,i.intake.partner.name,i.good.code,i.good.name,i.status,i.createdAt.toISOString(),i.intake.dueAt.toISOString(),i.checkedAt?.toISOString(),i.returnedAt?.toISOString()])],'intakes');
  }
  if(kind==='customer'||kind==='owner'){
    if(!allowed(actor,'financeRead'))return new NextResponse(null,{status:403});const partnerId=req.nextUrl.searchParams.get('partnerId');const partner=partnerId?await db.partner.findFirst({where:{id:partnerId,merchantId}}):null;if(!partner||!canAccessPartner(actor,partner))return new NextResponse(null,{status:404});const pid=partner.id;
    if(kind==='customer'){const data=await db.saleItem.findMany({where:{merchantId,sale:{customerId:pid}},include:{good:true,sale:true}});return csv([['销售单','货号','货品','应收','已收','未收'],...data.map(i=>[i.sale.number,i.good.code,i.good.name,yuan(i.netCents-i.returnedCents),yuan(i.paidCents),yuan(i.netCents-i.returnedCents-i.paidCents)])],'customer-statement')}
    const data=await db.payable.findMany({where:{merchantId,ownerId:pid,saleItem:assignedCustomers===null?undefined:{sale:{customerId:{in:assignedCustomers}}}},include:{saleItem:{include:{good:true}}}});return csv([['货号','货品','应付','已付','未付'],...data.map(i=>[i.saleItem.good.code,i.saleItem.good.name,yuan(i.amountCents+i.adjustedCents),yuan(i.paidCents),yuan(i.amountCents+i.adjustedCents-i.paidCents)])],'owner-statement');
  }
  return new NextResponse(null,{status:404});
}
