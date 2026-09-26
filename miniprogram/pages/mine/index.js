const api = require('../../utils/api');
Page({
  data: { me: null, partners: [], canEditPartners: false, canStocktake: false, canDamages: false, mode: 'list', name: '', phone: '', roleChoices: ['客户', '上游货主', '客户兼上游货主'], roleIndex: 0, error: '', busy: false, server: '' },
  onShow() { if (api.ensureLogin()) this.load(); },
  async load() {
    try { const [me, partners] = await Promise.all([api.request('me'), api.request('partners').catch(() => [])]); this.setData({ me, partners: partners.map(p => ({ ...p, rolesText: p.roles.join('、') })), canEditPartners: me.role === 'OWNER' || !!me.permissions.partners, canStocktake: me.role === 'OWNER' || !!me.permissions.stock, canDamages: me.role === 'OWNER' || !!me.permissions.stock || !!me.permissions.returns, server: api.baseUrl(), error: '' }); }
    catch (e) { this.setData({ error: e.message }); }
  },
  create() { this.setData({ mode: 'partner', name: '', phone: '', roleIndex: 0 }); },
  back() { this.setData({ mode: 'list' }); },
  edit(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  role(e) { this.setData({ roleIndex: Number(e.detail.value) }); },
  openStocktake() { wx.navigateTo({ url: '/pages/stocktake/index' }); },
  openDamages() { wx.navigateTo({ url: '/pages/damages/index' }); },
  async save() {
    if (!this.data.name.trim()) return api.fail(new Error('请填写合作方名称'));
    this.setData({ busy: true });
    try { await api.request('partners', 'POST', { name: this.data.name, phone: this.data.phone, roles: [['CUSTOMER'], ['OWNER'], ['CUSTOMER', 'OWNER']][this.data.roleIndex] }); await this.load(); this.back(); wx.showToast({ title: '合作方已建立' }); }
    catch (e) { api.fail(e); } finally { this.setData({ busy: false }); }
  },
  logout() { wx.removeStorageSync(api.KEY); wx.reLaunch({ url: '/pages/login/index' }); }
});
