const api = require('../../utils/api');
Page({
  data: { mode: 'list', sales: [], receipts: [], goods: [], partners: [], candidates: [], selected: [], canSales: false, canReceipts: false, canReturns: false, deliveryChoices: ['尚未交付', '已交付'], kindChoices: ['销售货款', '货物押金', '预付款'], physicalChoices: ['实物退回', '不退回，仅调价'], damageChoices: ['正常', '货损待处理'], query: '', customerIndex: -1, kindIndex: 0, deliveredIndex: 0, discount: '0', amount: '', method: '线下转账', note: '', reason: '', refund: '0', physicalIndex: 0, damageIndex: 0, saleItem: null, receipt: null, targetIndex: -1, targets: [], busy: false, error: '' },
  onShow() { if (api.ensureLogin()) this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    try {
      const [sales, receipts, goods, partners, me] = await Promise.all([
        api.request('sales').catch(() => []), api.request('receipts').catch(() => []), api.request('goods'), api.request('partners').catch(() => []), api.request('me')
      ]);
      this.setData({ sales: sales.map(s => ({ ...s, items: s.items.map(i => ({ ...i, netText: api.money(i.netCents), unpaidText: api.money(Number(i.netCents) - Number(i.returnedCents) - Number(i.paidCents)) })) })), receipts: receipts.map(r => ({ ...r, amountText: api.money(r.amountCents), availableText: api.money(Number(r.amountCents) - Number(r.allocatedCents)), hasBalance: Number(r.amountCents) > Number(r.allocatedCents) })), goods, partners: partners.filter(p => p.roles.includes('CUSTOMER')), canSales: me.role === 'OWNER' || !!me.permissions.sales, canReceipts: me.role === 'OWNER' || !!me.permissions.receipts, canReturns: me.role === 'OWNER' || !!me.permissions.returns, error: '' }); this.filter();
    } catch (e) { this.setData({ error: e.message }); }
  },
  filter() {
    const q = this.data.query.trim().toLowerCase();
    this.setData({ candidates: this.data.goods.filter(g => ['FREE', 'LOAN'].includes(g.occupancy) && g.quality === 'NORMAL' && !g.returnedUpstreamAt && (!q || `${g.code} ${g.name}`.toLowerCase().includes(q))).slice(0, 30) });
  },
  back() { this.setData({ mode: 'list', selected: [], saleItem: null, receipt: null }); },
  edit(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); if (e.currentTarget.dataset.field === 'query') this.filter(); },
  customer(e) { this.setData({ customerIndex: Number(e.detail.value) }); },
  kind(e) { this.setData({ kindIndex: Number(e.detail.value) }); },
  delivered(e) { this.setData({ deliveredIndex: Number(e.detail.value) }); },
  physical(e) { this.setData({ physicalIndex: Number(e.detail.value) }); },
  damage(e) { this.setData({ damageIndex: Number(e.detail.value) }); },
  target(e) { this.setData({ targetIndex: Number(e.detail.value) }); },
  createSale() { this.setData({ mode: 'sale', selected: [], query: '', customerIndex: -1, discount: '0', deliveredIndex: 0 }); this.filter(); },
  createReceipt() { this.setData({ mode: 'receipt', customerIndex: -1, kindIndex: 0, amount: '', note: '', method: '线下转账' }); },
  toggle(e) {
    const g = this.data.goods.find(x => x.id === e.currentTarget.dataset.id);
    if (!g) return;
    const selected = this.data.selected.some(x => x.id === g.id) ? this.data.selected.filter(x => x.id !== g.id) : [...this.data.selected, { ...g, price: g.askingCents == null ? '' : String(g.askingCents) }];
    this.setData({ selected });
  },
  price(e) { const id = e.currentTarget.dataset.id; this.setData({ selected: this.data.selected.map(g => g.id === id ? { ...g, price: e.detail.value } : g) }); },
  async scan() {
    try { const code = await api.scan(); this.setData({ query: code }); this.filter(); const g = this.data.candidates.find(x => x.code === code); if (g && !this.data.selected.some(x => x.id === g.id)) this.toggle({ currentTarget: { dataset: { id: g.id } } }); else if (!g) api.fail(new Error('货品当前不可成交')); } catch {}
  },
  async saveSale() {
    const customer = this.data.partners[this.data.customerIndex];
    if (!customer || !this.data.selected.length || this.data.selected.some(g => !g.price)) return api.fail(new Error('请选择客户、货品并填写逐件成交价'));
    this.setData({ busy: true });
    try {
      await api.request('sales', 'POST', { customerId: customer.id, discount: this.data.discount || '0', delivered: this.data.deliveredIndex === 1, items: this.data.selected.map(g => ({ goodId: g.id, price: g.price })) });
      await this.load(); this.back(); wx.showToast({ title: '成交已登记' });
    } catch (e) { api.fail(e); } finally { this.setData({ busy: false }); }
  },
  async saveReceipt() {
    const customer = this.data.partners[this.data.customerIndex];
    if (!customer || !this.data.amount) return api.fail(new Error('请选择客户和实收金额'));
    this.setData({ busy: true });
    try {
      await api.request('receipts', 'POST', { partnerId: customer.id, kind: ['SALES', 'DEPOSIT', 'ADVANCE'][this.data.kindIndex], amount: this.data.amount, method: this.data.method, note: this.data.note });
      await this.load(); this.back(); wx.showToast({ title: '收款已登记' });
    } catch (e) { api.fail(e); } finally { this.setData({ busy: false }); }
  },
  openItem(e) {
    const item = this.data.sales.reduce((all, sale) => all.concat(sale.items), []).find(x => x.id === e.currentTarget.dataset.id);
    this.setData({ mode: 'saleItem', saleItem: item });
  },
  async deliver() {
    try { await api.request(`sale-items/${this.data.saleItem.id}/deliver`, 'POST', {}); await this.load(); this.back(); wx.showToast({ title: '交付已登记' }); } catch (e) { api.fail(e); }
  },
  showReturn() { this.setData({ mode: 'return', amount: '', refund: '0', reason: '', physicalIndex: 0, damageIndex: 0 }); },
  async saveReturn() {
    if (!this.data.amount || !this.data.reason.trim()) return api.fail(new Error('请填写调整金额和原因'));
    this.setData({ busy: true });
    try {
      await api.request(`sale-items/${this.data.saleItem.id}/return`, 'POST', { physical: this.data.physicalIndex === 0, amount: this.data.amount, refund: this.data.refund || '0', damaged: this.data.damageIndex === 1, reason: this.data.reason });
      await this.load(); this.back(); wx.showToast({ title: '退货调整已记录' });
    } catch (e) { api.fail(e); } finally { this.setData({ busy: false }); }
  },
  openReceipt(e) {
    const receipt = this.data.receipts.find(r => r.id === e.currentTarget.dataset.id);
    const targets = this.data.sales.filter(s => s.customerId === receipt.partnerId).reduce((all, sale) => all.concat(sale.items), []).filter(i => Number(i.netCents) - Number(i.returnedCents) > Number(i.paidCents)).map(i => ({ id: i.id, name: `${i.good.code} · 未收 ${i.unpaidText}` }));
    this.setData({ mode: 'allocate', receipt, targets, targetIndex: -1, amount: '' });
  },
  async allocate() {
    const target = this.data.targets[this.data.targetIndex];
    if (!target || !this.data.amount) return api.fail(new Error('请选择货品并填写核销金额'));
    this.setData({ busy: true });
    try {
      const receipt = this.data.receipt;
      await api.request(`receipts/${receipt.id}/${receipt.kind === 'SALES' ? 'allocate' : 'apply'}`, 'POST', receipt.kind === 'SALES' ? { allocations: [{ saleItemId: target.id, amount: this.data.amount }] } : { saleItemId: target.id, amount: this.data.amount });
      await this.load(); this.back(); wx.showToast({ title: '款项已核销' });
    } catch (e) { api.fail(e); } finally { this.setData({ busy: false }); }
  },
  showRefund() { if (this.data.receipt && this.data.receipt.kind !== 'SALES') this.setData({ mode: 'refund', amount: '', reason: '' }); },
  async saveRefund() {
    const receipt = this.data.receipt;
    if (!receipt || !this.data.amount || !this.data.reason.trim()) return api.fail(new Error('请填写退款金额和原因'));
    this.setData({ busy: true });
    try {
      await api.request(`receipts/${receipt.id}/refund`, 'POST', { amount: this.data.amount, reason: this.data.reason });
      await this.load(); this.back(); wx.showToast({ title: '退款已登记' });
    } catch (e) { api.fail(e); } finally { this.setData({ busy: false }); }
  }
});
