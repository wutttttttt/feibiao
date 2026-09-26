import { cookies } from 'next/headers';
import { headers } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { db } from './db';

const cookieName = 'feicui_session';
function key() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('SESSION_SECRET 至少需要32个字符');
  return new TextEncoder().encode(value);
}
export async function issueMiniToken(userId: string) {
  return new SignJWT({ uid: userId, client: 'wechat-mini' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('12h').sign(key());
}
export async function createSession(userId: string) {
  const token = await new SignJWT({ uid: userId }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(key());
  (await cookies()).set(cookieName, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 7 * 86400 });
}
export async function clearSession() { (await cookies()).delete(cookieName); }
export async function currentUser() {
  const bearer = (await headers()).get('authorization');
  const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    if (typeof payload.uid !== 'string') return null;
    if (bearer && payload.client !== 'wechat-mini') return null;
    const user = await db.user.findUnique({ where: { id: payload.uid }, select: { id: true, merchantId: true, name: true, role: true, permissions: true, active: true } });
    return user?.active ? user : null;
  } catch { return null; }
}
export type Actor = NonNullable<Awaited<ReturnType<typeof currentUser>>>;
export function allowed(actor: Actor, permission: string) {
  return actor.role === 'OWNER' || (actor.permissions as Record<string, boolean>)[permission] === true;
}
export function requirePermission(actor: Actor, permission: string) {
  if (!allowed(actor, permission)) throw new AppError(403, '没有这项操作权限');
}
export function customerIds(actor: Actor): string[] | null {
  if (actor.role === 'OWNER') return null;
  const ids = (actor.permissions as Record<string, unknown>).customerIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}
export function canAccessPartner(actor: Actor, partner: { id: string; roles: string[] }) {
  const ids = customerIds(actor);
  return ids === null || !partner.roles.includes('CUSTOMER') || ids.includes(partner.id);
}
export function requirePartnerAccess(actor: Actor, partner: { id: string; roles: string[] }) {
  if (!canAccessPartner(actor, partner)) throw new AppError(404, '找不到合作方');
}
export function requireCustomerAccess(actor: Actor, partnerId: string) {
  const ids=customerIds(actor);
  if(ids!==null&&!ids.includes(partnerId))throw new AppError(404,'找不到客户业务');
}
export class AppError extends Error { constructor(public status: number, message: string) { super(message); } }
