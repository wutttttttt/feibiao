const api = require('../../utils/api');
Page({
  data: { baseUrl: '', login: '', password: '', busy: false, error: '' },
  onLoad() { this.setData({ baseUrl: api.baseUrl() }); },
  edit(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  async submit() {
    const url = this.data.baseUrl.trim().replace(/\/$/, '');
    if (!/^https?:\/\//.test(url)) return this.setData({ error: '请填写服务器完整地址' });
    if (!this.data.login || !this.data.password) return this.setData({ error: '请填写账号和密码' });
    this.setData({ busy: true, error: '' });
    wx.setStorageSync(api.URL_KEY, url);
    try {
      const result = await api.request('login', 'POST', { login: this.data.login, password: this.data.password }, false);
      if (!result.token) throw new Error('服务器未启用小程序登录');
      wx.setStorageSync(api.KEY, result.token);
      this.setData({ password: '' });
      wx.switchTab({ url: '/pages/home/index' });
    } catch (e) { this.setData({ error: e.message }); }
    finally { this.setData({ busy: false }); }
  }
});
