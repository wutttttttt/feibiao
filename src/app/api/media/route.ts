import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { db } from '@/lib/db';
import { currentUser, allowed } from '@/lib/auth';

export async function POST(req: NextRequest) {
  if(existsSync('.runtime/maintenance'))return NextResponse.json({error:'正在备份数据，请稍后再操作'},{status:503});
  const actor = await currentUser();
  if (!actor || !allowed(actor, 'goods')) return NextResponse.json({ error: '没有上传权限' }, { status: 403 });
  const form = await req.formData();
  const file = form.get('file'); const goodId = form.get('goodId');
  if (!(file instanceof File) || typeof goodId !== 'string') return NextResponse.json({ error: '请选择货品和图片' }, { status: 400 });
  const good = await db.good.findFirst({ where: { id: goodId, merchantId: actor.merchantId } });
  if (!good) return NextResponse.json({ error: '货品不存在' }, { status: 404 });
  if (file.size > 8*1024*1024) return NextResponse.json({ error: '图片不能超过8MB' }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
  const jpg = bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const webp = new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
  if (!png&&!jpg&&!webp) return NextResponse.json({ error: '只支持 JPEG、PNG 或 WebP 图片' }, { status: 400 });
  const ext = png?'png':jpg?'jpg':'webp';
  const name = `${randomUUID()}.${ext}`;
  const root = path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR || './storage');
  const dir = path.join(/* turbopackIgnore: true */ root, actor.merchantId);
  await mkdir(dir,{recursive:true});
  await writeFile(path.join(/* turbopackIgnore: true */ dir,name),bytes);
  const image = await db.goodImage.create({ data: { merchantId: actor.merchantId, goodId, fileName: name, mimeType: png?'image/png':jpg?'image/jpeg':'image/webp' } });
  return NextResponse.json({ id: image.id });
}
