import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import { hash } from '@/lib/common';
export async function GET(req: NextRequest,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const image=await db.goodImage.findUnique({where:{id}});
  if(!image)return new NextResponse(null,{status:404});
  const actor=await currentUser();
  let ok=actor?.merchantId===image.merchantId;
  const share=req.nextUrl.searchParams.get('share');
  if(!ok&&share){const link=await db.shareLink.findUnique({where:{tokenHash:hash(share)}});ok=Boolean(link&&link.merchantId===image.merchantId&&link.kind==='GOOD'&&link.targetId===image.goodId&&!link.revokedAt&&link.expiresAt>new Date());}
  if(!ok)return new NextResponse(null,{status:403});
  try{const root=path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR||'./storage');const file=await readFile(path.join(/* turbopackIgnore: true */ root,image.merchantId,image.fileName));return new NextResponse(file,{headers:{'Content-Type':image.mimeType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}catch{return new NextResponse(null,{status:404})}
}
