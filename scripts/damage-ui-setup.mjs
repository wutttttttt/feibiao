import { randomUUID } from 'node:crypto';

const base = process.env.FEICUI_BASE_URL || 'http://127.0.0.1:3000';
const logged = await fetch(`${base}/api/v1/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client': 'wechat-mini' }, body: JSON.stringify({ login: 'boss', password: 'DemoBoss2026!' }) });
const { token } = await logged.json();
if (!logged.ok || !token) throw new Error('演示老板登录失败');
async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(method === 'POST' ? { 'Idempotency-Key': randomUUID() } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}：${JSON.stringify(result)}`);
  return result;
}
const customer = (await request('partners')).find(p => p.roles.includes('CUSTOMER'));
if (!customer) throw new Error('演示库缺少客户');
const code = `UI-DM-${randomUUID().slice(0, 8)}`;
const good = await request('goods', 'POST', { code, name: '浏览器货损复核验收货', category: '挂件' });
const loan = await request('loans', 'POST', { partnerId: customer.id, receiverName: '演示接收人', goodIds: [good.id] });
await request(`loan-items/${loan.items[0].id}/return`, 'POST', { condition: 'DAMAGED', note: '演示货表面碰痕，待老板复核' });
console.log(`待复核演示异常货：${code}`);
