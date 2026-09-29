import { describe, expect, it } from 'vitest';
import { bootstrapConfig, bootstrapOwner } from '../scripts/bootstrap-owner';

describe('正式老板账号初始化', () => {
  it('只在空库原子创建商家、老板和首个位置', async () => {
    const created: Record<string, any> = {};
    const tx = {
      user: { count: async () => 0, create: async ({ data }: any) => created.user = { id: 'u1', ...data } },
      merchant: { count: async () => 0, create: async ({ data }: any) => created.merchant = { id: 'm1', ...data } },
      location: { create: async ({ data }: any) => created.location = { id: 'l1', ...data } },
    };
    const db = { $transaction: async (fn: any) => fn(tx) } as any;
    const config = bootstrapConfig({ BOOTSTRAP_MERCHANT_NAME: '内测商家', BOOTSTRAP_OWNER_LOGIN: 'owner', BOOTSTRAP_OWNER_NAME: '老板', BOOTSTRAP_OWNER_PASSWORD: 'Long-Test-Pass-2026' });
    expect(await bootstrapOwner(db, config)).toEqual({ merchantId: 'm1', ownerId: 'u1', login: 'owner' });
    expect(created.user.passwordHash).not.toBe(config.password);
    expect(created.location).toMatchObject({ merchantId: 'm1', name: '摊位' });
  });

  it('拒绝弱密码和已有数据的数据库', async () => {
    expect(() => bootstrapConfig({ BOOTSTRAP_MERCHANT_NAME: '商家', BOOTSTRAP_OWNER_LOGIN: 'owner', BOOTSTRAP_OWNER_NAME: '老板', BOOTSTRAP_OWNER_PASSWORD: 'too-short' })).toThrow('至少需要16位');
    const db = { $transaction: async (fn: any) => fn({ user: { count: async () => 1 }, merchant: { count: async () => 1 } }) } as any;
    await expect(bootstrapOwner(db, { merchantName: '商家', login: 'owner', ownerName: '老板', password: 'Long-Test-Pass-2026', locationName: '摊位' })).rejects.toThrow('完全空');
  });
});
