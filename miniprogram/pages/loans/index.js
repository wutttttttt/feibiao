const api = require('../../utils/api');
Page({
  data: { view: 'outbound', loans: [], intakes: [], goods: [], reusableGoods: [], partners: [], owners: [], locations: [], canTransfer: false, canCost: false, conditionChoices: ['正常', '货损待处理'], transferChoices: ['仅登记待核实线索', '已核实并授权责任承接'], checkChoices: ['正常入库', '异常入库', '拒收退回'], settlementChoices: ['继承货主默认','固定价','比例分成'], mode: 'list', customerIndex: -1, ownerIndex: -1, locationIndex: -1, transferIndex: -1, transferConfirmed: 0, receiverName: '', dueAt: '', note: '', query: '', selected: [], candidates: [], item: null, intake: null, intakeLines: [], checkResult: 'NORMAL', condition: 'NORMAL', busy: false },
  onShow() { if (api.ensureLogin()) this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    try {
      const [loans, intakes, goods, partners, locations, me] = await Promise.all([api.request('loans'), api.request('intakes'), api.request('goods'), api.request('partners'), api.request('locations'), api.request('me')]);
      this.setData({ loans: loans.map(l => ({ ...l, items: l.items.map(i => ({ ...i, statusText: ({ OUT: '未还', RETURNED: '已还', SOLD: '已成交' })[i.status] || i.status })) })), intakes: intakes.map(x => ({ ...x, statusText: ({ RECEIVING: '待核对', ACTIVE: '借入中', CLOSED: '已结清' })[x.status], items: x.items.map(i => ({ ...i, statusText: ({ PENDING: '待入库确认', ACTIVE: '在借', RETURNED: '已退上游', SOLD: '已成交', REJECTED: '已拒收' })[i.status] })) })), goods, reusableGoods: goods.filter(g => g.ownershipKind === 'CONSIGN' && g.returnedUpstreamAt), partners: partners.filter(p => p.roles.includes('CUSTOMER')), owners: partners.filter(p => p.roles.includes('OWNER') || p.roles.includes('SUPPLIER')), locations, canTransfer: me.role === 'OWNER' || !!me.permissions.transfer, canCost: me.role === 'OWNER' || !!me.permissions.cost }); this.filter();
    } catch (e) { api.fail(e); }
  },
  filter() { const q = this.data.query.trim().toLowerCase(); this.setData({ candidates: this.data.goods.filter(g => g.occupancy === 'FREE' && g.holderKind === 'MERCHANT' && g.quality === 'NORMAL' && !g.returnedUpstreamAt && (!q || `${g.code} ${g.name}`.toLowerCase().includes(q))).slice(0, 30) }); },
  create() { this.setData({ mode: 'create', selected: [], customerIndex: -1, receiverName: '', dueAt: '', query: '' }); this.filter(); },
  showOutbound() { this.setData({ view: 'outbound', mode: 'list', selected: [], item: null }); },
  showInbound() { this.setData({ view: 'inbound', mode: 'list', selected: [], item: null }); },
  createIntake() { this.setData({ mode: 'intake-create', ownerIndex: -1, locationIndex: -1, receiverName: '', dueAt: '', note: '', intakeLines: [this.emptyIntakeLine()] }); },
  emptyIntakeLine() { return { existingGoodId: '', code: '', name: '', category: '', asking: '', declared: '', conditionNote: '', settlementType: '', settlementFixed: '', settlementRateBp: '' }; },
  back() { this.setData({ mode: 'list', item: null }); },
  edit(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); if (e.currentTarget.dataset.field === 'query') this.filter(); },
  customer(e) { this.setData({ customerIndex: Number(e.detail.value) }); },
  location(e) { this.setData({ locationIndex: Number(e.detail.value) }); },
  owner(e) { this.setData({ ownerIndex: Number(e.detail.value) }); },
  lineEdit(e) { const index = Number(e.currentTarget.dataset.index); const field = e.currentTarget.dataset.field; this.setData({ intakeLines: this.data.intakeLines.map((line, i) => i === index ? { ...line, [field]: e.detail.value } : line) }); },
  addLine() { this.setData({ intakeLines: [...this.data.intakeLines, this.emptyIntakeLine()] }); },
  removeLine(e) { const index = Number(e.currentTarget.dataset.index); if (this.data.intakeLines.length > 1) this.setData({ intakeLines: this.data.intakeLines.filter((_, i) => i !== index) }); },
  settlement(e) { const index = Number(e.currentTarget.dataset.index); const type = ['', 'FIXED', 'RATE'][Number(e.detail.value)]; this.setData({ intakeLines: this.data.intakeLines.map((line, i) => i === index ? { ...line, settlementType: type } : line) }); },
  reuseGood(e) { const index = Number(e.currentTarget.dataset.index); const good = this.data.reusableGoods[Number(e.detail.value)]; this.setData({ intakeLines: this.data.intakeLines.map((line, i) => i === index ? { ...line, existingGoodId: good ? good.id : '', ...(good ? { code: '', name: '', category: '', asking: '' } : {}) } : line) }); },
  clearReuse(e) { const index = Number(e.currentTarget.dataset.index); this.setData({ intakeLines: this.data.intakeLines.map((line, i) => i === index ? { ...line, existingGoodId: '' } : line) }); },
  async scanIntake(e) { try { const code = await api.scan(); const index = Number(e.currentTarget.dataset.index); this.setData({ intakeLines: this.data.intakeLines.map((line, i) => i === index ? { ...line, code } : line) }); } catch {} },
  async saveIntake() {
    const owner = this.data.owners[this.data.ownerIndex]; const location = this.data.locations[this.data.locationIndex];
    if (!owner || !location || !this.data.receiverName.trim() || !this.data.dueAt || this.data.intakeLines.some(x => !x.existingGoodId && (!x.name.trim() || !x.category.trim()))) return api.fail(new Error('请填写货主、交货人、应还日、暂存位置和每件货品'));
    this.setData({ busy: true });
    try { await api.request('intakes', 'POST', { partnerId: owner.id, receiverName: this.data.receiverName, dueAt: this.data.dueAt, locationId: location.id, note: this.data.note, items: this.data.intakeLines }); await this.load(); this.back(); wx.showToast({ title: '收货已记录' }); } catch (e) { api.fail(e); } finally { this.setData({ busy: false }); }
  },
  openIntakeItem(e) { const intake = this.data.intakes.find(x => x.id === e.currentTarget.dataset.intake); const item = intake && intake.items.find(x => x.id === e.currentTarget.dataset.id); if (!item || item.returnBlockedReason || !['PENDING','ACTIVE'].includes(item.status)) return; this.setData({ intake, item, mode: item.status === 'PENDING' ? 'intake-check' : 'intake-return', checkResult: 'NORMAL', checkSettlementType: '', checkSettlementFixed: '', checkSettlementRateBp: '', selected: item.status === 'ACTIVE' ? [item.id] : [], note: '' }); },
  checkKind(e) { this.setData({ checkResult: ['NORMAL','DAMAGED','REJECTED'][Number(e.detail.value)] }); },
  checkSettlement(e) { this.setData({ checkSettlementType: ['', 'FIXED', 'RATE'][Number(e.detail.value)] }); },
  async saveCheck() { const item = this.data.item; if (!item || this.data.checkResult !== 'NORMAL' && !this.data.note.trim()) return api.fail(new Error('非正常结果请填写核对说明')); this.setData({ busy: true }); try { await api.request(`intake-items/${item.id}/check-in`, 'POST', { result: this.data.checkResult, note: this.data.note, settlementType: this.data.checkSettlementType || undefined, settlementFixed: this.data.checkSettlementFixed || undefined, settlementRateBp: this.data.checkSettlementRateBp || undefined }); await this.load(); this.back(); wx.showToast({ title: '核对已记录' }); } catch (e) { api.fail(e); } finally { this.setData({ busy: false }); } },
  toggleIntakeReturn(e) { const id = e.currentTarget.dataset.id; this.setData({ selected: this.data.selected.includes(id) ? this.data.selected.filter(x => x !== id) : [...this.data.selected, id] }); },
  async saveIntakeReturn() { if (!this.data.intake || !this.data.selected.length || !this.data.note.trim()) return api.fail(new Error('请选择货品并填写退还原因')); this.setData({ busy: true }); try { await api.request(`intakes/${this.data.intake.id}/return`, 'POST', { itemIds: this.data.selected, reason: this.data.note }); await this.load(); this.back(); wx.showToast({ title: '已退还上游' }); } catch (e) { api.fail(e); } finally { this.setData({ busy: false }); } },
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
