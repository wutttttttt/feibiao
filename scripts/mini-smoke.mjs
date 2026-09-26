const base = process.env.FEICUI_BASE_URL || 'http://127.0.0.1:3000';
const login = async (name, password) => {
  const res = await fetch(`${base}/api/v1/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-client': 'wechat-mini' },
    body: JSON.stringify({ login: name, password })
  });
  const body = await res.json();
  if (res.status !== 200 || !body.token || body.expiresIn !== 43200) throw new Error(`${name} 小程序登录失败：${JSON.stringify(body)}`);
  return body.token;
};
const read = async (path, token) => {
  const res = await fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: path.includes('/media/') ? null : await res.json() };
};
const boss = await login('boss', 'DemoBoss2026!');
const staff = await login('staff', 'DemoStaff2026!');
const me = await read('/api/v1/me', boss);
if (me.status !== 200 || me.body.role !== 'OWNER') throw new Error('Bearer 老板身份校验失败');
const goods = await read('/api/v1/goods', boss);
if (goods.status !== 200 || goods.body.length < 50) throw new Error('小程序货品读取失败');
const staffGoods = await read('/api/v1/goods', staff);
if (staffGoods.status !== 200 || staffGoods.body.some(g => 'costCents' in g || 'floorCents' in g)) throw new Error('员工可见成本');
const noAuth = await read('/api/v1/me');
if (noAuth.status !== 401) throw new Error('未授权访问未被拒绝');
const invalid = await read('/api/v1/me', 'invalid-token');
if (invalid.status !== 401) throw new Error('无效凭证未被拒绝');
console.log(`小程序接口验收通过：老板与员工登录、${goods.body.length} 件货、员工成本隔离、未授权拒绝`);
