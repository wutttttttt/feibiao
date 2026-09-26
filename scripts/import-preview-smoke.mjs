import { readFileSync } from 'node:fs';

const base = process.env.FEICUI_BASE_URL || 'http://127.0.0.1:3000';
const login = await fetch(`${base}/api/v1/login`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-client': 'wechat-mini' },
  body: JSON.stringify({ login: 'boss', password: 'DemoBoss2026!' })
});
if (!login.ok) throw new Error('演示老板登录失败');
const { token } = await login.json();
for (const [filename, expectedName] of [['goods.csv', '示例翡翠手镯'], ['goods.xlsx', '测试翠件']]) {
  const path = filename.endsWith('.xlsx') ? 'tests/fixtures/goods.xlsx' : 'templates/goods.csv';
  const form = new FormData();
  form.append('kind', 'goods');
  form.append('file', new Blob([readFileSync(path)]), filename);
  const result = await fetch(`${base}/api/import?preview=1`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const body = await result.json();
  if (!result.ok || body.rows?.[0]?.name !== expectedName) throw new Error(`${filename} 预览失败：${JSON.stringify(body)}`);
}
console.log('CSV 与 XLSX 实际 HTTP 导入预览均通过');
