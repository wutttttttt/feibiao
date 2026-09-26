import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { AppError } from './auth';

export function money(value: unknown, field = '金额'): bigint {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,2})?$/.test(value)) throw new AppError(400, `${field}须填写非负金额，最多两位小数`);
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
  if (cents > 9_000_000_000_000_000n) throw new AppError(400, `${field}过大`);
  return cents;
}
export function positiveMoney(value: unknown, field = '金额') { const n = money(value, field); if (n <= 0n) throw new AppError(400, `${field}必须大于0`); return n; }
export function yuan(cents: bigint | number | null | undefined) { if (cents == null) return null; return (Number(cents) / 100).toFixed(2); }
export function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function token() { return randomBytes(32).toString('base64url'); }
export function docNo(prefix: string) { const date = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}).replaceAll('-',''); return `${prefix}${date}-${randomBytes(5).toString('hex').toUpperCase()}`; }
export function asString(value: unknown, name: string): string { if (typeof value !== 'string' || !value.trim()) throw new AppError(400, `请填写${name}`); return value.trim(); }
export function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v)); }
export function serialize(value: unknown) { return JSON.parse(JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? yuan(v) : v)); }
export function splitDiscount(gross: bigint[], discount: bigint) {
  const sum = gross.reduce((a,b) => a+b, 0n);
  if (sum <= 0n || discount < 0n || discount > sum) throw new AppError(400, '优惠金额不能超过成交原价');
  let used = 0n;
  return gross.map((value, index) => { const part = index === gross.length - 1 ? discount - used : value * discount / sum; used += part; return part; });
}
export function rateAmount(net: bigint, bp: number) { if (!Number.isInteger(bp) || bp < 0 || bp > 10000) throw new AppError(400, '比例须在0至100%之间'); return (net * BigInt(bp) + 5000n) / 10000n; }
