import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

type BootstrapConfig = { merchantName: string; login: string; ownerName: string; password: string; locationName: string };
type BootstrapDb = Pick<PrismaClient, '$transaction'>;

export function bootstrapConfig(env: Record<string, string | undefined> = process.env): BootstrapConfig {
  const merchantName = env.BOOTSTRAP_MERCHANT_NAME?.trim();
  const login = env.BOOTSTRAP_OWNER_LOGIN?.trim();
  const ownerName = env.BOOTSTRAP_OWNER_NAME?.trim();
  const password = env.BOOTSTRAP_OWNER_PASSWORD || '';
  const locationName = env.BOOTSTRAP_LOCATION_NAME?.trim() || '摊位';
  if (!merchantName || !login || !ownerName) throw new Error('请设置 BOOTSTRAP_MERCHANT_NAME、BOOTSTRAP_OWNER_LOGIN 和 BOOTSTRAP_OWNER_NAME');
  if (password.length < 16) throw new Error('BOOTSTRAP_OWNER_PASSWORD 至少需要16位');
  return { merchantName, login, ownerName, password, locationName };
}

export async function bootstrapOwner(db: BootstrapDb, config: BootstrapConfig) {
  return db.$transaction(async tx => {
    if (await tx.user.count() || await tx.merchant.count()) throw new Error('初始化只允许在完全空的新数据库执行');
    const merchant = await tx.merchant.create({ data: { name: config.merchantName } });
    const owner = await tx.user.create({ data: { merchantId: merchant.id, login: config.login, name: config.ownerName, role: 'OWNER', passwordHash: await bcrypt.hash(config.password, 12), permissions: {} } });
    await tx.location.create({ data: { merchantId: merchant.id, name: config.locationName } });
    return { merchantId: merchant.id, ownerId: owner.id, login: owner.login };
  });
}

async function main() {
  const db = new PrismaClient();
  try {
    const result = await bootstrapOwner(db, bootstrapConfig());
    console.log(`正式老板账号已创建：${result.login}；请妥善保存密码并立即登录验证。`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
