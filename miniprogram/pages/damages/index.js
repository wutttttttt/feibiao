const api = require('../../utils/api');
Page({
  data: { damages: [], selected: null, canReview: false, responsibilityChoices: ['尚未确认', '客户', '上游货主', '本摊', '其他'], responsibilityIndex: 0, dispositionChoices: ['继续待处理', '已修复，恢复可售', '确认报损，继续不可售'], dispositionIndex: 0, reason: '', imageId: '', photo: '', busy: false, error: '' },
  onShow() { if (api.ensureLogin()) this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    try {
      const [damages, me] = await Promise.all([api.request('damages'), api.request('me')]);
      this.setData({ damages: damages.map(d => ({ ...d, state: d.resolvedAt ? '已结案' : '待处理' })), canReview: me.role === 'OWNER', error: '' });
    } catch (e) { this.setData({ error: e.message }); }
  },
  async open(e) {
    const selected = this.data.damages.find(d => d.id === e.currentTarget.dataset.id);
    this.setData({ selected: selected || null, responsibilityIndex: ['UNCONFIRMED', 'CUSTOMER', 'UPSTREAM', 'MERCHANT', 'OTHER'].indexOf(selected?.responsibility || 'UNCONFIRMED'), dispositionIndex: 0, reason: '', imageId: '', photo: '' });
    if (selected?.photoFile) try { this.setData({ photo: await api.downloadPhoto(selected.photoFile) }); } catch {}
  },
  back() { this.setData({ selected: null, reason: '', imageId: '', photo: '' }); },
  responsibility(e) { this.setData({ responsibilityIndex: Number(e.detail.value) }); },
  disposition(e) { this.setData({ dispositionIndex: Number(e.detail.value) }); },
  editReason(e) { this.setData({ reason: e.detail.value }); },
  async attachPhoto() {
    const selected = this.data.selected;
    if (!selected || !this.data.canReview) return;
    try {
      const chosen = await new Promise((resolve, reject) => wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera', 'album'], success: resolve, fail: reject }));
      const filePath = chosen.tempFiles[0].tempFilePath;
      const image = await api.uploadPhoto(selected.goodId, filePath);
      this.setData({ imageId: image.id, photo: filePath });
      wx.showToast({ title: '凭证照片已上传' });
    } catch (e) { if (e.message) api.fail(e); }
  },
  async save() {
    const selected = this.data.selected;
    const reason = this.data.reason.trim();
    if (!selected || !this.data.canReview || !reason) return api.fail(new Error('请填写复核说明'));
    this.setData({ busy: true });
    try {
      await api.request(`damages/${selected.id}/review`, 'POST', { disposition: ['KEEP_HOLD', 'RESTORE', 'WRITE_OFF'][this.data.dispositionIndex], responsibility: ['UNCONFIRMED', 'CUSTOMER', 'UPSTREAM', 'MERCHANT', 'OTHER'][this.data.responsibilityIndex], reason, ...(this.data.imageId ? { imageId: this.data.imageId } : {}) });
      await this.load(); this.back(); wx.showToast({ title: '复核已记录' });
    } catch (e) { api.fail(e); } finally { this.setData({ busy: false }); }
  }
});
