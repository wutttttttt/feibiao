import { randomUUID } from 'node:crypto';

const base = process.env.FEICUI_BASE_URL || 'http://127.0.0.1:3000';
const login = await fetch(`${base}/api/v1/login`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-client': 'wechat-mini' },
  body: JSON.stringify({ login: 'boss', password: 'DemoBoss2026!' }),
});
const credential = await login.json();
if (!login.ok || !credential.token) throw new Error('演示老板登录失败');
async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}/api/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${credential.token}`, 'content-type': 'application/json', ...(method === 'POST' ? { 'Idempotency-Key': randomUUID() } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}：${JSON.stringify(result)}`);
  return result;
}
const tag = randomUUID().slice(0, 8);
const target = await request('locations', 'POST', { name: `HTTP盘点货位-${tag}` });
const elsewhere = await request('locations', 'POST', { name: `HTTP其他货位-${tag}` });
const good = await request('goods', 'POST', { code: `HT-${tag}`, name: 'HTTP错位测试货', category: '挂件', locationId: elsewhere.id });
const take = await request('stocktakes', 'POST', { locationId: target.id });
const wrong = await request(`stocktakes/${take.id}/scan`, 'POST', { code: good.code });
const unknown = await request(`stocktakes/${take.id}/scan`, 'POST', { code: `UNKNOWN-${tag}` });
if (wrong.kind !== 'WRONG_LOCATION' || unknown.kind !== 'UNREGISTERED') throw new Error('差异类型不正确');
let current = (await request('stocktakes')).find(row => row.id === take.id);
if (current.findings.length !== 2) throw new Error('差异未持久保存');
const extra = current.findings.find(row => row.kind === 'UNREGISTERED');
const misplaced = current.findings.find(row => row.kind === 'WRONG_LOCATION');
await request(`stocktake-findings/${extra.id}/resolve`, 'POST', { disposition: 'IGNORE', reason: '核实为非本摊货号' });
await request(`stocktake-findings/${misplaced.id}/resolve`, 'POST', { disposition: 'MOVE_HERE', reason: '核实实物已在盘点货位' });
const closed = await request(`stocktakes/${take.id}/close`, 'POST', { reason: '两项差异已复核' });
const moved = await request(`goods/${good.id}`);
current = (await request('stocktakes')).find(row => row.id === take.id);
if (closed.missing !== 0 || moved.locationId !== target.id || current.status !== 'CLOSED' || current.findings.some(row => row.status !== 'RESOLVED')) {
  throw new Error('复核后货位、差异或盘点状态不一致');
}
console.log(`实际 HTTP 盘点差异验收通过：${good.code} 错位移入、未登记货号留痕、复核结案`);
