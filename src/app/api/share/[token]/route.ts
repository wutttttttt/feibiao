import { NextRequest,NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hash, serialize } from '@/lib/common';
export async function POST(req:NextRequest,{params}:{params:Promise<{token:string}>}){
  const {token}=await params; const link=await db.shareLink.findUnique({where:{tokenHash:hash(token)}});
  if(!link||link.revokedAt||link.expiresAt<=new Date())return NextResponse.json({error:'链接已失效'},{status:404});
  if(link.pinHash){const body=await req.json();if(link.attempts>=10)return NextResponse.json({error:'访问次数过多，请联系摊主'},{status:429});if(hash(String(body.pin||''))!==link.pinHash){await db.shareLink.update({where:{id:link.id},data:{attempts:{increment:1}}});return NextResponse.json({error:'访问码错误'},{status:403});}}
  let result:unknown;
  if(link.kind==='GOOD'){
    const g=await db.good.findFirst({where:{id:link.targetId,merchantId:link.merchantId},include:{images:true}});
    const source=(g?.attributes||{}) as Record<string,unknown>;
    const attributes=Object.fromEntries(['size','ringSize','color','texture','flaw'].filter(k=>source[k]!==undefined).map(k=>[k,source[k]]));
    result=g&&{kind:'GOOD',updatedAt:g.updatedAt,good:{code:g.code,name:g.name,category:g.category,attributes,weightGrams:g.weightGrams,certificateNo:g.certificateNo,askingCents:g.askingCents,status:g.occupancy==='FREE'?'可咨询':'请联系摊主确认',images:g.images.map(i=>i.id)}};
  }else if(link.kind==='LOAN'){
    const p=await db.partner.findFirst({where:{id:link.targetId,merchantId:link.merchantId}});
    const rows=await db.loanItem.findMany({where:{merchantId:link.merchantId,status:'OUT',loan:{partnerId:link.targetId}},include:{good:{select:{code:true,name:true}},loan:{select:{number:true,dueAt:true}}}});
    result=p&&{kind:'LOAN',name:p.name,items:rows.map(r=>({code:r.good.code,name:r.good.name,number:r.loan.number,dueAt:r.loan.dueAt}))};
  }else if(link.kind==='CUSTOMER_STATEMENT'){
    const p=await db.partner.findFirst({where:{id:link.targetId,merchantId:link.merchantId}});
    const rows=await db.saleItem.findMany({where:{merchantId:link.merchantId,sale:{customerId:link.targetId}},include:{good:{select:{code:true,name:true}},sale:{select:{number:true,createdAt:true}}}});
    result=p&&{kind:'CUSTOMER_STATEMENT',name:p.name,items:rows.map(r=>({code:r.good.code,name:r.good.name,number:r.sale.number,date:r.sale.createdAt,amountCents:r.netCents-r.returnedCents,paidCents:r.paidCents,unpaidCents:r.netCents-r.returnedCents-r.paidCents}))};
  }else{
    const p=await db.partner.findFirst({where:{id:link.targetId,merchantId:link.merchantId}});
    const rows=await db.payable.findMany({where:{merchantId:link.merchantId,ownerId:link.targetId},include:{saleItem:{include:{good:{select:{code:true,name:true}}}}}});
    result=p&&{kind:'OWNER_STATEMENT',name:p.name,items:rows.map(r=>({code:r.saleItem.good.code,name:r.saleItem.good.name,amountCents:r.amountCents+r.adjustedCents,paidCents:r.paidCents,unpaidCents:r.amountCents+r.adjustedCents-r.paidCents}))};
  }
  if(!result)return NextResponse.json({error:'分享内容不存在'},{status:404});
  return NextResponse.json(serialize({...result,updatedAt:new Date()}));
}
