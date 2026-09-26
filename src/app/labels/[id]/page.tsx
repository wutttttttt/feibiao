import { notFound } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import LabelPreview from './LabelPreview';

export default async function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return <main style={{ padding: 24 }}>请先在系统首页登录，再打开标签。</main>;
  const { id } = await params;
  const good = await db.good.findFirst({ where: { id, merchantId: actor.merchantId }, select: { code: true, name: true } });
  if (!good) notFound();
  return <LabelPreview good={good} />;
}
