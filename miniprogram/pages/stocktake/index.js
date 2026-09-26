const api = require('../../utils/api');
Page({
  data: { takes: [], locations: [], goods: [], me: null, canClose: false, showClose: false, locationIndex: -1, active: null, code: '', result: '', reviewReason: '', selectedFinding: null, findingReason: '', dispositionIndex: 0, dispositionChoices: ['确认移入本位置', '核实后不纳入本次盘点'], busy: false },
  onShow() { if (api.ensureLogin()) this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    try {
      const [takes, locations, goods, me] = await Promise.all([api.request('stocktakes'), api.request('locations'), api.request('goods'), api.request('me')]);
      const byId = goods.reduce((all, g) => { all[g.id] = g; return all; }, {});
      const rows = takes.map(t => ({ ...t, locationName: locations.find(l => l.id === t.locationId)?.name || '未知位置', checked: t.items.filter(i => i.seen).length, count: t.items.length, items: t.items.map(i => ({ ...i, code: byId[i.goodId]?.code || '已移出的货品', name: byId[i.goodId]?.name || '', state: i.seen ? i.note || '已核对' : '未核对' })), findings: (t.findings || []).map(f => ({ ...f, kindText: ({ WRONG_LOCATION: '错位货', UNREGISTERED: '未登记货号', EXTRA: '快照外多货' })[f.kind] || f.kind })).filter(f => f.status === 'OPEN') }));
      const active = this.data.active && rows.find(t => t.id === this.data.active.id);
      const canClose = me.role === 'OWNER' || !!me.permissions.stockApprove;
      this.setData({ takes: rows, locations, goods, me, canClose, active: active || null, showClose: !!active && active.status === 'OPEN' && canClose });
    } catch (e) { api.fail(e); }
  },
  location(e) { this.setData({ locationIndex: Number(e.detail.value) }); },
  edit(e) { this.setData({ code: e.detail.value }); },
  async create() {
    const selected = this.data.locations[this.data.locationIndex];
    if (!selected) return api.fail(new Error('请先选择盘点位置'));
    this.setData({ busy: true });
    try { const take = await api.request('stocktakes', 'POST', { locationId: selected.id }); await this.load(); this.open({ currentTarget: { dataset: { id: take.id } } }); wx.showToast({ title: '盘点已建立' }); }
    catch (e) { api.fail(e); } finally { this.setData({ busy: false }); }
  },
  open(e) { const take = this.data.takes.find(t => t.id === e.currentTarget.dataset.id); this.setData({ active: take, showClose: !!take && take.status === 'OPEN' && this.data.canClose, code: '', result: '', reviewReason: '', selectedFinding: null, findingReason: '' }); },
  back() { this.setData({ active: null, showClose: false, code: '', result: '', reviewReason: '', selectedFinding: null, findingReason: '' }); },
  editReason(e) { this.setData({ reviewReason: e.detail.value }); },
  editFindingReason(e) { this.setData({ findingReason: e.detail.value }); },
  disposition(e) { this.setData({ dispositionIndex: Number(e.detail.value) }); },
  selectFinding(e) { if (!this.data.canClose) return; const finding = this.data.active.findings.find(f => f.id === e.currentTarget.dataset.id); this.setData({ selectedFinding: finding || null, findingReason: '', dispositionIndex: finding?.kind === 'UNREGISTERED' ? 1 : 0 }); },
  async resolveFinding() {
    const finding = this.data.selectedFinding;
    const reason = this.data.findingReason.trim();
    if (!finding || !this.data.canClose || !reason) return api.fail(new Error('请填写差异处置说明'));
    this.setData({ busy: true });
    try {
      const disposition = this.data.dispositionIndex === 0 ? 'MOVE_HERE' : 'IGNORE';
      await api.request(`stocktake-findings/${finding.id}/resolve`, 'POST', { disposition, reason });
      this.setData({ selectedFinding: null, findingReason: '' });
      await this.load(); wx.showToast({ title: '差异已复核' });
    } catch (e) { api.fail(e); } finally { this.setData({ busy: false }); }
  },
  async scan() { try { const code = await api.scan(); this.setData({ code }); await this.mark(); } catch {} },
  async mark() {
    const take = this.data.active;
    const code = this.data.code.trim();
    if (!take || !code) return api.fail(new Error('请扫描或填写货号'));
    this.setData({ busy: true });
    try {
      const result = await api.request(`stocktakes/${take.id}/scan`, 'POST', { code });
      const message = ({ SEEN: '已核对', RECHECK: '流转后已重新核对', MOVED_OUT: '货品已移出本位置', EXTRA: '快照外多货，待复核', WRONG_LOCATION: '错位货，待复核', UNREGISTERED: '未登记货号，待复核' })[result.kind] || result.kind;
      await this.load(); this.setData({ code: '', result: `${code}：${message}` });
    } catch (e) { api.fail(e); } finally { this.setData({ busy: false }); }
  },
  close() {
    const take = this.data.active;
    if (!take || !this.data.canClose) return;
    if ((take.findings || []).length) return api.fail(new Error('请先逐项复核多货与错位差异'));
    const reason = this.data.reviewReason.trim();
    if (!reason) return api.fail(new Error('请填写盘点复核说明'));
    const missing = take.count - take.checked;
    wx.showModal({ title: '复核盘点差异', content: missing ? `尚有 ${missing} 件未核对，确认后将转为待处理。请先核实实物与流转记录。` : '全部已核对，确认结束盘点？', confirmText: '确认结束', success: async response => {
      if (!response.confirm) return;
      this.setData({ busy: true });
      try { await api.request(`stocktakes/${take.id}/close`, 'POST', { reason }); await this.load(); this.back(); wx.showToast({ title: '盘点已结束' }); }
      catch (e) { api.fail(e); } finally { this.setData({ busy: false }); }
    } });
  }
});
