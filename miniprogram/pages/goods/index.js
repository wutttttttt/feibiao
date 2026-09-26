const api = require('../../utils/api');
const blank = () => ({ code: '', name: '', category: '', asking: '', ownershipKind: 'OWN' });
Page({
  data: { goods: [], visible: [], partners: [], locations: [], canGoods: false, canSales: false, ownershipChoices: ['自有货', '寄售货'], query: '', mode: 'list', form: blank(), ownerIndex: -1, locationIndex: -1, detail: null, photo: '', busy: false },
  onShow() { if (api.ensureLogin()) this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    try {
      const [goods, partners, locations, me] = await Promise.all([api.request('goods'), api.request('partners').catch(() => []), api.request('locations'), api.request('me')]);
      this.setData({ goods, partners: partners.filter(p => p.roles.includes('OWNER')), locations, canGoods: me.role === 'OWNER' || !!me.permissions.goods, canSales: me.role === 'OWNER' || !!me.permissions.sales }); this.filter();
    } catch (e) { api.fail(e); }
  },
  filter() {
    const q = this.data.query.trim().toLowerCase();
    this.setData({ visible: this.data.goods.filter(g => !q || `${g.code} ${g.name} ${g.category}`.toLowerCase().includes(q)).slice(0, 100).map(g => ({ ...g, state: ({ FREE: '可用', LOAN: '外借', RESERVED: '预留', SOLD: '已成交' })[g.occupancy] || g.occupancy, askingText: api.money(g.askingCents) })) });
  },
  search(e) { this.setData({ query: e.detail.value }); this.filter(); },
  async scan() { try { const code = await api.scan(); this.setData({ query: code }); this.filter(); } catch {} },
  showCreate() { if (this.data.canGoods) this.setData({ mode: 'create', form: blank(), ownerIndex: -1, locationIndex: -1 }); },
  async scanInbound() {
    if (!this.data.canGoods) return api.fail(new Error('没有录货权限'));
    let code;
    try { code = await api.scan(); } catch { return; }
    if (!code) return api.fail(new Error('未识别到货号，请重试或手工输入'));
    try {
      const existing = await this.findCode(code);
      if (existing) return api.fail(new Error(`货号 ${code} 已入库，请用扫码查货处理原货`));
      if (this.data.mode === 'create') this.setData({ 'form.code': code });
      else this.setData({ mode: 'create', form: { ...blank(), code }, ownerIndex: -1, locationIndex: -1 });
    } catch (e) { api.fail(e); }
  },
  async findCode(code) {
    const goods = await api.request(`goods?code=${encodeURIComponent(code)}`);
    return goods.find(g => g.code === code);
  },
  back() { this.setData({ mode: 'list', detail: null, photo: '' }); },
  edit(e) { this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  ownership(e) { this.setData({ 'form.ownershipKind': Number(e.detail.value) === 0 ? 'OWN' : 'CONSIGN' }); },
  owner(e) { this.setData({ ownerIndex: Number(e.detail.value) }); },
  location(e) { this.setData({ locationIndex: Number(e.detail.value) }); },
  async save() {
    if (!this.data.canGoods) return api.fail(new Error('没有录货权限'));
    const f = this.data.form;
    if (!f.name.trim() || !f.category.trim()) return api.fail(new Error('请填写货品名称和品类'));
    const code = f.code.trim();
    if (code && (code.length > 80 || /[\r\n]/.test(code))) return api.fail(new Error('货号最多 80 字，不能包含换行'));
    const owner = this.data.partners[this.data.ownerIndex];
    if (f.ownershipKind === 'CONSIGN' && !owner) return api.fail(new Error('寄售货请选上游货主'));
    this.setData({ busy: true });
    try {
      if (code && await this.findCode(code)) throw new Error(`货号 ${code} 已入库，请用扫码查货处理原货`);
      const good = await api.request('goods', 'POST', { ...f, code: code || undefined, ownerPartnerId: owner && owner.id, locationId: this.data.locations[this.data.locationIndex] && this.data.locations[this.data.locationIndex].id });
      await this.load();
      await this.open({ currentTarget: { dataset: { id: good.id } } });
      wx.showToast({ title: `已入库 ${good.code || ''}`, icon: 'success' });
    } catch (e) { api.fail(e); } finally { this.setData({ busy: false }); }
  },
  async open(e) {
    const id = e.currentTarget.dataset.id;
    try {
      const detail = await api.request(`goods/${id}`);
      this.setData({ detail, mode: 'detail', photo: '' });
      if (detail.images && detail.images[0]) {
        try { this.setData({ photo: await api.downloadPhoto(detail.images[0].id) }); } catch (error) { api.fail(error); }
      }
    } catch (error) { api.fail(error); }
  },
  async addPhoto() {
    if (!this.data.canGoods) return api.fail(new Error('没有上传照片权限'));
    const detail = this.data.detail;
    if (!detail) return;
    try {
      const chosen = await new Promise((resolve, reject) => wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera', 'album'], success: resolve, fail: reject }));
      await api.uploadPhoto(detail.id, chosen.tempFiles[0].tempFilePath);
      await this.load(); await this.open({ currentTarget: { dataset: { id: detail.id } } });
      wx.showToast({ title: '照片已上传' });
    } catch (e) { if (e.message) api.fail(e); }
  },
  async reserve() {
    if (!this.data.canSales) return api.fail(new Error('没有预留权限'));
    const g = this.data.detail;
    try {
      await api.request(`goods/${g.id}/${g.occupancy === 'RESERVED' ? 'unreserve' : 'reserve'}`, 'POST', {});
      await this.load(); await this.open({ currentTarget: { dataset: { id: g.id } } });
      wx.showToast({ title: '状态已更新' });
    } catch (e) { api.fail(e); }
  }
});
