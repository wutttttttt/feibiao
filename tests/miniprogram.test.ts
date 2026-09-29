import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const api = require('../miniprogram/utils/api.js');
const originalWx = (globalThis as any).wx;
const originalPage = (globalThis as any).Page;
const originalRequest = api.request;
const originalScan = api.scan;
afterEach(() => { (globalThis as any).wx = originalWx; (globalThis as any).Page = originalPage; api.request = originalRequest; api.scan = originalScan; });
function pageOf(moduleName: string) {
  let definition: any;
  (globalThis as any).Page = (value: any) => { definition = value; };
  const file = require.resolve(`../miniprogram/pages/${moduleName}/index.js`);
  delete require.cache[file];
  require(file);
  return { ...definition, data: { ...definition.data }, setData(patch: any) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.');
      let target = this.data;
      for (const part of parts.slice(0, -1)) target = target[part];
      target[parts[parts.length - 1]] = value;
    }
  } };
}

describe('微信小程序接入', () => {
  it('接口金额按元字符串展示，不重复除以100', () => {
    expect(api.money('1234.56')).toBe('¥1234.56');
  });

  it('拿货和成交沿用接口报价的元数值', () => {
    const originalPage = (globalThis as any).Page;
    const definitions: any[] = [];
    (globalThis as any).Page = (definition: any) => definitions.push(definition);
    try {
      for (const moduleName of ['loans', 'accounts']) {
        const file = require.resolve(`../miniprogram/pages/${moduleName}/index.js`);
        delete require.cache[file];
        require(file);
        const definition = definitions.pop();
        const page = { ...definition, data: { ...definition.data, goods: [{ id: 'g1', code: 'F1', askingCents: '1234.56' }], selected: [] }, setData(patch: any) { Object.assign(this.data, patch); } };
        page.toggle({ currentTarget: { dataset: { id: 'g1' } } });
        expect(page.data.selected[0].price).toBe('1234.56');
      }
    } finally { (globalThis as any).Page = originalPage; }
  });
  it('入口与五个主页面齐全', () => {
    const root = resolve('miniprogram');
    const config = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8'));
    expect(config.tabBar.list).toHaveLength(5);
    for (const page of config.pages) {
      for (const extension of ['js', 'json', 'wxml']) {
        expect(() => readFileSync(resolve(root, `${page}.${extension}`))).not.toThrow();
      }
    }
  });

  it('货品页按权限显示录货与预留入口', async () => {
    api.request = async (path: string) => {
      if (path === 'goods' || path === 'partners' || path === 'locations') return [];
      if (path === 'me') return { role: 'STAFF', permissions: { goods: false, sales: false } };
      throw new Error(path);
    };
    const page = pageOf('goods');
    await page.load();
    expect(page.data.canGoods).toBe(false);
    expect(page.data.canSales).toBe(false);
    page.showCreate();
    expect(page.data.mode).toBe('list');
  });

  it('扫码新货号后保存为真实入库货品并打开详情', async () => {
    const calls: any[] = [];
    api.scan = async () => 'RL-NEW-001';
    (globalThis as any).wx = { showToast: () => {} };
    api.request = async (path: string, method = 'GET', body?: any) => {
      calls.push({ path, method, body });
      if (path === 'goods?code=RL-NEW-001') return [];
      if (path === 'goods' && method === 'POST') return { id: 'g1', code: body.code };
      if (path === 'goods/g1') return { id: 'g1', code: 'RL-NEW-001', images: [], movements: [{ action: 'OWN_RECEIPT' }] };
      if (path === 'goods' || path === 'partners' || path === 'locations') return [];
      if (path === 'me') return { role: 'OWNER', permissions: {} };
      throw new Error(path);
    };
    const page = pageOf('goods');
    await page.load();
    await page.scanInbound();
    expect(page.data.mode).toBe('create');
    expect(page.data.form.code).toBe('RL-NEW-001');
    page.edit({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '翡翠手镯' } });
    page.edit({ currentTarget: { dataset: { field: 'category' } }, detail: { value: '手镯' } });
    await page.save();
    expect(calls.find(c => c.path === 'goods' && c.method === 'POST').body).toMatchObject({ code: 'RL-NEW-001', name: '翡翠手镯', category: '手镯', ownershipKind: 'OWN' });
    expect(page.data.mode).toBe('detail');
    expect(page.data.detail.movements[0].action).toBe('OWN_RECEIPT');
  });

  it('扫码已存在货号时阻止重复入库', async () => {
    const calls: any[] = [];
    const errors: string[] = [];
    api.scan = async () => 'RL-OLD-001';
    (globalThis as any).wx = { showToast: (options: any) => errors.push(options.title) };
    api.request = async (path: string, method = 'GET') => {
      calls.push({ path, method });
      if (path === 'goods?code=RL-OLD-001') return [{ id: 'old', code: 'RL-OLD-001' }];
      throw new Error(path);
    };
    const page = pageOf('goods');
    page.data.canGoods = true;
    await page.scanInbound();
    expect(page.data.mode).toBe('list');
    expect(errors[0]).toContain('已入库');
    expect(calls.every(c => c.method !== 'POST')).toBe(true);
  });

  it('账号登录不带旧凭证，业务请求使用 Bearer 与幂等键', async () => {
    const seen: any[] = [];
    (globalThis as any).wx = {
      getStorageSync: (key: string) => key.endsWith('.url') ? 'https://ledger.example' : 'mini-token',
      request: (options: any) => { seen.push(options); options.success({ statusCode: 200, data: { ok: true } }); }
    };
    await api.request('login', 'POST', { login: 'boss', password: 'example' }, false);
    await api.request('goods');
    await api.request('loans', 'POST', { goodIds: [] });
    expect(seen[0].header.Authorization).toBeUndefined();
    expect(seen[1].header.Authorization).toBe('Bearer mini-token');
    expect(seen[2].header['Idempotency-Key']).toBeTruthy();
    expect(seen[2].url).toBe('https://ledger.example/api/v1/loans');
  });

  it('受保护图片使用凭证下载，过期凭证从设备移除', async () => {
    const removed: string[] = [];
    (globalThis as any).wx = {
      getStorageSync: (key: string) => key.endsWith('.url') ? 'https://ledger.example' : 'mini-token',
      downloadFile: (options: any) => { expect(options.header.Authorization).toBe('Bearer mini-token'); options.success({ statusCode: 200, tempFilePath: '/tmp/photo.jpg' }); },
      request: (options: any) => options.success({ statusCode: 401, data: { error: '请先登录' } }),
      removeStorageSync: (key: string) => removed.push(key),
      reLaunch: () => {}
    };
    expect(await api.downloadPhoto('image-id')).toBe('/tmp/photo.jpg');
    await expect(api.request('goods')).rejects.toThrow('请先登录');
    expect(removed).toEqual([api.KEY]);
  });

  it('小程序盘点扫码展示重新核对结果，结束操作只提供给有复核权限的员工', async () => {
    const calls: any[] = [];
    api.request = async (path: string, method = 'GET', body?: any) => {
      calls.push({ path, method, body });
      if (path === 'stocktakes/t1/scan') return { kind: 'RECHECK', code: 'F1' };
      if (path === 'stocktakes') return [{ id: 't1', locationId: 'l1', status: 'OPEN', items: [{ id: 'i1', goodId: 'g1', seen: true, note: '流转后已重新核对' }] }];
      if (path === 'locations') return [{ id: 'l1', name: '摊位' }];
      if (path === 'goods') return [{ id: 'g1', code: 'F1', name: '测试货' }];
      if (path === 'me') return { role: 'STAFF', permissions: { stock: true } };
      throw new Error(path);
    };
    const page = pageOf('stocktake');
    page.data.active = { id: 't1' };
    page.data.code = 'F1';
    await page.mark();
    expect(calls[0]).toEqual({ path: 'stocktakes/t1/scan', method: 'POST', body: { code: 'F1' } });
    expect(page.data.result).toContain('流转后已重新核对');
    expect(page.data.canClose).toBe(false);
  });

  it('小程序盘点差异必须带处置方式与原因提交给共享账本', async () => {
    const calls: any[] = [];
    (globalThis as any).wx = { showToast: () => {} };
    api.request = async (path: string, method = 'GET', body?: any) => {
      calls.push({ path, method, body });
      if (path === 'stocktakes') return [{ id: 't1', locationId: 'l1', status: 'OPEN', items: [], findings: [] }];
      if (path === 'locations') return [{ id: 'l1', name: '摊位' }];
      if (path === 'goods') return [];
      if (path === 'me') return { role: 'OWNER', permissions: {} };
      return { status: 'RESOLVED' };
    };
    const page = pageOf('stocktake');
    Object.assign(page.data, { active: { id: 't1', findings: [{ id: 'f1', code: 'F1' }] }, selectedFinding: { id: 'f1', code: 'F1' }, findingReason: '现场核实在摊位', dispositionIndex: 0, canClose: true });
    await page.resolveFinding();
    expect(calls[0]).toEqual({ path: 'stocktake-findings/f1/resolve', method: 'POST', body: { disposition: 'MOVE_HERE', reason: '现场核实在摊位' } });
  });

  it('小程序货损复核只提交责任、结案方式和说明', async () => {
    const calls: any[] = [];
    (globalThis as any).wx = { showToast: () => {} };
    api.request = async (path: string, method = 'GET', body?: any) => {
      calls.push({ path, method, body });
      if (path === 'damages') return [];
      if (path === 'me') return { role: 'OWNER', permissions: {} };
      return { status: 'RESOLVED' };
    };
    const page = pageOf('damages');
    Object.assign(page.data, { selected: { id: 'd1', goodId: 'g1' }, canReview: true, dispositionIndex: 2, responsibilityIndex: 1, reason: '实物已确认破损' });
    await page.save();
    expect(calls[0]).toEqual({ path: 'damages/d1/review', method: 'POST', body: { disposition: 'WRITE_OFF', responsibility: 'CUSTOMER', reason: '实物已确认破损' } });
  });

  it('已核实转交明确提交接收人和责任承接', async () => {
    const calls: any[] = [];
    (globalThis as any).wx = { showToast: () => {} };
    api.request = async (path: string, method = 'GET', body?: any) => {
      calls.push({ path, method, body });
      if (path === 'loans' || path === 'intakes') return [];
      if (path === 'goods') return [];
      if (path === 'partners') return [{ id: 'p2', name: '接收人', roles: ['CUSTOMER'] }];
      if (path === 'locations') return [];
      if (path === 'me') return { role: 'OWNER', permissions: {} };
      return { status: 'CONFIRMED' };
    };
    const page = pageOf('loans');
    Object.assign(page.data, { item: { id: 'li1' }, transferConfirmed: 1, transferIndex: 0, partners: [{ id: 'p2' }], note: '现场已核实' });
    await page.saveTransfer();
    expect(calls[0]).toEqual({ path: 'loan-items/li1/transfer', method: 'POST', body: { confirmed: true, partnerId: 'p2', note: '现场已核实' } });
  });

  it('小程序借入按实到货逐件建档、核对并批量退还', async () => {
    const calls: any[] = [];
    (globalThis as any).wx = { showToast: () => {} };
    api.request = async (path: string, method = 'GET', body?: any) => { calls.push({ path, method, body }); return { ok: true }; };
    const page = pageOf('loans');
    page.load = async () => {};
    Object.assign(page.data, { owners: [{ id: 'owner1' }], ownerIndex: 0, locations: [{ id: 'loc1' }], locationIndex: 0, receiverName: '送货人', dueAt: '2026-12-31', intakeLines: [{ code: 'J-1', name: '借入手镯', category: '手镯', settlementType: 'RATE', settlementRateBp: '8000' }] });
    await page.saveIntake();
    expect(calls[0]).toEqual({ path: 'intakes', method: 'POST', body: expect.objectContaining({ partnerId: 'owner1', locationId: 'loc1', items: [expect.objectContaining({ code: 'J-1' })] }) });
    Object.assign(page.data, { item: { id: 'ii1' }, checkResult: 'DAMAGED', note: '到货裂纹', checkSettlementType: '', checkSettlementFixed: '', checkSettlementRateBp: '' });
    await page.saveCheck();
    expect(calls[1]).toEqual({ path: 'intake-items/ii1/check-in', method: 'POST', body: expect.objectContaining({ result: 'DAMAGED', note: '到货裂纹' }) });
    Object.assign(page.data, { intake: { id: 'in1' }, selected: ['ii1','ii2'], note: '到期退还' });
    await page.saveIntakeReturn();
    expect(calls[2]).toEqual({ path: 'intakes/in1/return', method: 'POST', body: { itemIds: ['ii1','ii2'], reason: '到期退还' } });
  });

  it('小程序再次收货复用已退上游的原货品档案', async () => {
    const calls: any[] = [];
    (globalThis as any).wx = { showToast: () => {} };
    api.request = async (path: string, method = 'GET', body?: any) => { calls.push({ path, method, body }); return { ok: true }; };
    const page = pageOf('loans');
    page.load = async () => {};
    Object.assign(page.data, { owners: [{ id: 'owner1' }], ownerIndex: 0, locations: [{ id: 'loc1' }], locationIndex: 0, receiverName: '再次送货', dueAt: '2026-12-31', reusableGoods: [{ id: 'g-old', code: 'J-OLD' }], intakeLines: [page.emptyIntakeLine()] });
    page.reuseGood({ currentTarget: { dataset: { index: 0 } }, detail: { value: '0' } });
    await page.saveIntake();
    expect(calls[0]).toEqual({ path: 'intakes', method: 'POST', body: expect.objectContaining({ items: [expect.objectContaining({ existingGoodId: 'g-old' })] }) });
  });

  it('押金退款使用独立退款动作，不再登记第二笔收款', async () => {
    const calls: any[] = [];
    (globalThis as any).wx = { showToast: () => {} };
    api.request = async (path: string, method = 'GET', body?: any) => {
      calls.push({ path, method, body });
      if (path === 'sales' || path === 'receipts' || path === 'goods' || path === 'partners') return [];
      if (path === 'me') return { role: 'OWNER', permissions: {} };
      return { id: 'refund1' };
    };
    const page = pageOf('accounts');
    Object.assign(page.data, { receipt: { id: 'r1', kind: 'DEPOSIT' }, amount: '50.00', reason: '客户退回货物' });
    await page.saveRefund();
    expect(calls[0]).toEqual({ path: 'receipts/r1/refund', method: 'POST', body: { amount: '50.00', reason: '客户退回货物' } });
  });
});
