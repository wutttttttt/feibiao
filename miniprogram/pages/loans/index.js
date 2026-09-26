const api = require('../../utils/api');
Page({
  data: { loans: [], goods: [], partners: [], locations: [], canTransfer: false, conditionChoices: ['正常', '货损待处理'], transferChoices: ['仅登记待核实线索', '已核实并授权责任承接'], mode: 'list', customerIndex: -1, locationIndex: -1, transferIndex: -1, transferConfirmed: 0, receiverName: '', dueAt: '', note: '', query: '', selected: [], candidates: [], item: null, condition: 'NORMAL', busy: false },
  onShow() { if (api.ensureLogin()) this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    try {
      const [loans, goods, partners, locations, me] = await Promise.all([api.request('loans'), api.request('goods'), api.request('partners'), api.request('locations'), api.request('me')]);
      this.setData({ loans: loans.map(l => ({ ...l, items: l.items.map(i => ({ ...i, statusText: ({ OUT: '未还', RETURNED: '已还', SOLD: '已成交' })[i.status] || i.status })) })), goods, partners: partners.filter(p => p.roles.includes('CUSTOMER')), locations, canTransfer: me.role === 'OWNER' || !!me.permissions.transfer }); this.filter();
    } catch (e) { api.fail(e); }
  },
  filter() { const q = this.data.query.trim().toLowerCase(); this.setData({ candidates: this.data.goods.filter(g => g.occupancy === 'FREE' && g.holderKind === 'MERCHANT' && g.quality === 'NORMAL' && !g.returnedUpstreamAt && (!q || `${g.code} ${g.name}`.toLowerCase().includes(q))).slice(0, 30) }); },
  create() { this.setData({ mode: 'create', selected: [], customerIndex: -1, receiverName: '', dueAt: '', query: '' }); this.filter(); },
  back() { this.setData({ mode: 'list', item: null }); },
  edit(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); if (e.currentTarget.dataset.field === 'query') this.filter(); },
  customer(e) { this.setData({ customerIndex: Number(e.detail.value) }); },
  location(e) { this.setData({ locationIndex: Number(e.detail.value) }); },
  toggle(e) {
    const g = this.data.goods.find(x => x.id === e.currentTarget.dataset.id);
    if (!g) return;
    const selected = this.data.selected.some(x => x.id === g.id) ? this.data.selected.filter(x => x.id !== g.id) : [...this.data.selected, { ...g, price: g.askingCents == null ? '' : String(g.askingCents) }];
    this.setData({ selected });
  },
  price(e) { const id = e.currentTarget.dataset.id; this.setData({ selected: this.data.selected.map(g => g.id === id ? { ...g, price: e.detail.value } : g) }); },
  async scan() {
    try { const code = await api.scan(); this.setData({ query: code }); this.filter(); const g = this.data.candidates.find(x => x.code === code); if (g && !this.data.selected.some(x => x.id === g.id)) this.toggle({ currentTarget: { dataset: { id: g.id } } }); else if (!g) api.fail(new Error('货品当前不可拿货')); } catch {}
  },
  async save() {
    const p = this.data.partners[this.data.customerIndex];
    if (!p || !this.data.receiverName.trim() || !this.data.selected.length) return api.fail(new Error('请选择客户、接收人和货品'));
    this.setData({ busy: true });
    try {
      const selected = this.data.selected;
      const prices = selected.reduce((all, g) => { if (g.price) all[g.id] = g.price; return all; }, {});
      await api.request('loans', 'POST', { partnerId: p.id, receiverName: this.data.receiverName, dueAt: this.data.dueAt || undefined, note: this.data.note, goodIds: selected.map(g => g.id), prices });
      await this.load(); this.back(); wx.showToast({ title: '交接已记录' });
    } catch (e) { api.fail(e); } finally { this.setData({ busy: false }); }
  },
  openItem(e) {
    const item = this.data.loans.reduce((all, loan) => all.concat(loan.items), []).find(i => i.id === e.currentTarget.dataset.id);
    this.setData({ item, mode: 'item', condition: 'NORMAL', locationIndex: -1, note: '' });
  },
  condition(e) { this.setData({ condition: Number(e.detail.value) === 0 ? 'NORMAL' : 'DAMAGED' }); },
  showTransfer() { this.setData({ mode: 'transfer', transferConfirmed: 0, transferIndex: -1, note: '' }); },
  transferKind(e) { this.setData({ transferConfirmed: Number(e.detail.value) }); },
  transferReceiver(e) { this.setData({ transferIndex: Number(e.detail.value) }); },
  async saveTransfer() {
    const item = this.data.item;
    const confirmed = this.data.transferConfirmed === 1;
    const receiver = this.data.partners[this.data.transferIndex];
    if (!this.data.note.trim() || confirmed && !receiver) return api.fail(new Error('请填写转交记录并选择实际接收人'));
    this.setData({ busy: true });
    try {
      await api.request(`loan-items/${item.id}/transfer`, 'POST', { confirmed, partnerId: confirmed ? receiver.id : undefined, note: this.data.note });
      await this.load(); this.back(); wx.showToast({ title: confirmed ? '责任已承接' : '线索已登记' });
    } catch (e) { api.fail(e); } finally { this.setData({ busy: false }); }
  },
  async returnItem() {
    const item = this.data.item;
    if (!item || item.status !== 'OUT') return;
    this.setData({ busy: true });
    try {
      const location = this.data.locations[this.data.locationIndex];
      await api.request(`loan-items/${item.id}/return`, 'POST', { condition: this.data.condition, locationId: location && location.id, note: this.data.note });
      await this.load(); this.back(); wx.showToast({ title: '验货已记录' });
    } catch (e) { api.fail(e); } finally { this.setData({ busy: false }); }
  },
  goSale() { wx.switchTab({ url: '/pages/accounts/index' }); }
});
