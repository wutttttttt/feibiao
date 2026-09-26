import { NextRequest, NextResponse } from 'next/server';
import { parseImportFile } from '@/lib/import-reader';
import { db } from '@/lib/db';
import { allowed, currentUser } from '@/lib/auth';
import { hash } from '@/lib/common';
import * as b from '@/lib/business';
import { existsSync } from 'node:fs';

const fields: Record<string,string[]> = { goods:['externalId','name','category','ownershipKind'], partners:['externalId','name','roles'], opening:['externalId','partnerExternalId','kind','amount'], loans:['externalId','documentExternalId','customerExternalId','goodExternalId','receiverName'] };
function check(kind:string,rows:any[]){const errors:any[]=[];const seen=new Set<string>();rows.forEach((r,i)=>{const n=i+2;for(const k of fields[kind]||[])if(!String(r[k]??'').trim())errors.push({row:n,message:`缺少 ${k}`});const externalId=String(r.externalId||'');if(seen.has(externalId))errors.push({row:n,message:'文件内外部编号重复'});seen.add(externalId);if(kind==='goods'&&r.ownershipKind==='CONSIGN'&&!r.ownerExternalId)errors.push({row:n,message:'寄售货缺少 ownerExternalId'});if(kind==='opening'&&!['AR','AP'].includes(r.kind))errors.push({row:n,message:'kind 只能是 AR 或 AP'})});return errors}
export async function POST(req:NextRequest){
  if(existsSync('.runtime/maintenance'))return NextResponse.json({error:'正在备份数据，请稍后再操作'},{status:503});
  const actor=await currentUser();if(!actor||!allowed(actor,'imports'))return NextResponse.json({error:'没有导入权限'},{status:403});
  if(req.nextUrl.searchParams.get('preview')==='1'){
    const form=await req.formData();const file=form.get('file');const kind=String(form.get('kind')||'');
    if(!(file instanceof File)||!fields[kind])return NextResponse.json({error:'文件或导入类型无效'},{status:400});
    if(file.size>5*1024*1024)return NextResponse.json({error:'文件不能超过5MB'},{status:400});
    const rows=await parseImportFile(new Uint8Array(await file.arrayBuffer()),file.name);
    if(rows.length>2000)return NextResponse.json({error:'单次最多2000行'},{status:400});
    return NextResponse.json({total:rows.length,rows,errors:check(kind,rows)});
  }
  const body=await req.json();const kind=String(body.kind||'');const rows=body.rows;
  if(!fields[kind]||!Array.isArray(rows)||rows.length>2000)return NextResponse.json({error:'导入数据无效'},{status:400});
  const errors=check(kind,rows);if(errors.length)return NextResponse.json({errors},{status:400});
  const fileHash=hash(JSON.stringify({kind,rows}));
  const existing=await db.importBatch.findUnique({where:{merchantId_kind_fileHash:{merchantId:actor.merchantId,kind,fileHash}}});
  if(existing)return NextResponse.json({message:'这份数据已导入',created:0,duplicate:rows.length});
  const batch=await db.importBatch.create({data:{merchantId:actor.merchantId,kind,fileHash,actorId:actor.id}});
  let created=0,duplicate=0;const failures:any[]=[];
  if(kind==='loans'){
    const groups=new Map<string,Array<{row:any;index:number}>>();
    rows.forEach((row:any,index:number)=>{const key=String(row.documentExternalId);groups.set(key,[...(groups.get(key)||[]),{row,index}])});
    for(const [documentExternalId,group] of groups){
      try{
        const already=await db.importRow.findFirst({where:{externalId:{in:group.map(x=>String(x.row.externalId))},batch:{merchantId:actor.merchantId,kind:'loans'},status:'CREATED'}});
        if(already){duplicate+=group.length;for(const x of group)await db.importRow.create({data:{batchId:batch.id,externalId:String(x.row.externalId),status:'DUPLICATE'}});continue}
        const customer=await db.partner.findFirst({where:{merchantId:actor.merchantId,externalId:String(group[0].row.customerExternalId)}});
        if(!customer)throw new Error('找不到客户外部编号');
        const goodIds=[];
        for(const x of group){const good=await db.good.findFirst({where:{merchantId:actor.merchantId,externalId:String(x.row.goodExternalId)}});if(!good)throw new Error(`找不到货品外部编号 ${x.row.goodExternalId}`);goodIds.push(good.id)}
        await b.createLoan(actor,{partnerId:customer.id,receiverName:String(group[0].row.receiverName),dueAt:group[0].row.dueAt||undefined,note:`导入单号 ${documentExternalId}`,goodIds});
        created+=group.length;for(const x of group)await db.importRow.create({data:{batchId:batch.id,externalId:String(x.row.externalId),status:'CREATED'}});
      }catch(e:any){for(const x of group){failures.push({row:x.index+2,message:e.message});await db.importRow.create({data:{batchId:batch.id,externalId:String(x.row.externalId),status:'FAILED',message:e.message}})}}
    }
    return NextResponse.json({created,duplicate,failures});
  }
  for(let i=0;i<rows.length;i++){
    const r=rows[i],externalId=String(r.externalId);
    try{
      if(kind==='goods'){
        const prior=await db.good.findFirst({where:{merchantId:actor.merchantId,externalId}});if(prior){duplicate++;await db.importRow.create({data:{batchId:batch.id,externalId,status:'DUPLICATE'}});continue}
        const owner=r.ownerExternalId?await db.partner.findFirst({where:{merchantId:actor.merchantId,externalId:String(r.ownerExternalId)}}):null;
        await b.createGood(actor,{...r,ownerPartnerId:owner?.id});
      }else if(kind==='partners'){
        const prior=await db.partner.findFirst({where:{merchantId:actor.merchantId,externalId}});if(prior){duplicate++;await db.importRow.create({data:{batchId:batch.id,externalId,status:'DUPLICATE'}});continue}
        await b.createPartner(actor,{...r,roles:String(r.roles).split('|')});
      }else{
        const prior=await db.importRow.findFirst({where:{externalId,batch:{merchantId:actor.merchantId,kind},status:'CREATED'}});if(prior){duplicate++;await db.importRow.create({data:{batchId:batch.id,externalId,status:'DUPLICATE'}});continue}
        const p=await db.partner.findFirst({where:{merchantId:actor.merchantId,externalId:String(r.partnerExternalId)}});if(!p)throw new Error('找不到合作方外部编号');
        await b.openingBalance(actor,{...r,partnerId:p.id});
      }
      created++;await db.importRow.create({data:{batchId:batch.id,externalId,status:'CREATED'}});
    }catch(e:any){failures.push({row:i+2,message:e.message});await db.importRow.create({data:{batchId:batch.id,externalId,status:'FAILED',message:e.message}})}
  }
  return NextResponse.json({created,duplicate,failures});
}
