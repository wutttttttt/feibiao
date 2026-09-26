const api = require('../../utils/api');
Page({
  data: { dashboard: {}, metrics: [], error: '' },
  onShow() { if (api.ensureLogin()) this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    try {
      const d = await api.request('dashboard');
      this.setData({ dashboard: d, error: '', metrics: [
        { label: '在手可售', value: `${d.inHand} 件` },
        { label: '外借未还', value: `${d.onLoan} 件` },
        { label: '客户未付', value: api.money(d.customerUnpaid) },
        { label: '上游未付', value: api.money(d.supplierUnpaid) },
        { label: '今日成交', value: api.money(d.todaySales) },
        { label: '本月实收', value: api.money(d.received) }
      ] });
    } catch (e) { this.setData({ error: e.message }); }
  },
  go(e) { wx.switchTab({ url: `/pages/${e.currentTarget.dataset.page}/index` }); }
});
