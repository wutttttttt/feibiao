import { randomUUID } from 'node:crypto';

const base = process.env.FEICUI_BASE_URL || 'http://127.0.0.1:3000';
async function login(name, password) {
  const result = await fetch(`${base}/api/v1/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client': 'wechat-mini' }, body: JSON.stringify({ login: name, password }) });
  const body = await result.json();
  if (!result.ok || !body.token) throw new Error(`${name} 登录失败`);
  return body.token;
}
const boss = await login('boss', 'DemoBoss2026!');
const staff = await login('staff', 'DemoStaff2026!');
async function request(path, method = 'GET', body, credential = boss) {
  const response = await fetch(`${base}/api/v1/${path}`, {
    method, headers: { Authorization: `Bearer ${credential}`, 'content-type': 'application/json', ...(method === 'POST' ? { 'Idempotency-Key': randomUUID() } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
async function success(path, method = 'GET', body) {
  const result = await request(path, method, body);
  if (result.status !== 200) throw new Error(`${path}：${JSON.stringify(result.body)}`);
  return result.body;
}
const partner = (await success('partners')).find(p => p.roles.includes('CUSTOMER'));
if (!partner) throw new Error('演示库缺少客户');
const before = (await success('money-entries')).length;
const tag = randomUUID().slice(0, 8);
const good = await success('goods', 'POST', { code: `DM-${tag}`, name: 'HTTP货损复核测试货', category: '挂件' });
const loan = await success('loans', 'POST', { partnerId: partner.id, receiverName: '演示接收人', goodIds: [good.id] });
await success(`loan-items/${loan.items[0].id}/return`, 'POST', { condition: 'DAMAGED', note: '表面碰痕待核实' });
const damage = (await success('damages')).find(d => d.goodId === good.id && !d.resolvedAt);
if (!damage) throw new Error('归还后未形成异常记录');
const denied = await request(`damages/${damage.id}/review`, 'POST', { disposition: 'RESTORE', responsibility: 'CUSTOMER', reason: '员工擅自放行' }, staff);
if (denied.status !== 403) throw new Error('员工货损复核未被拒绝');
await success(`damages/${damage.id}/review`, 'POST', { disposition: 'KEEP_HOLD', responsibility: 'UNCONFIRMED', reason: '继续等待检查' });
if ((await success(`goods/${good.id}`)).quality !== 'HOLD') throw new Error('继续待处理后品质状态错误');
await success(`damages/${damage.id}/review`, 'POST', { disposition: 'RESTORE', responsibility: 'MERCHANT', reason: '已检查修复并确认正常' });
if ((await success(`goods/${good.id}`)).quality !== 'NORMAL') throw new Error('修复后未恢复可售');
if ((await success('money-entries')).length !== before) throw new Error('货损复核错误地生成资金记录');
console.log(`实际 HTTP 货损复核验收通过：${good.code} 员工拒绝、待处理、修复放行且无自动扣款`);
