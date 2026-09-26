'use client';

type Item = { id: string; goodId: string; expectedVersion: number; seen: boolean };
type Finding = { id: string; code: string; kind: string; status: string; resolution?: string | null };
type Take = Record<string, any>;
type Good = Record<string, any>;

export default function StocktakeReview({ take, goods, canClose, onClose, onResolve }: {
  take?: Take;
  goods: Good[];
  canClose: boolean;
  onClose: (reason: string) => void;
  onResolve: (id: string, disposition: string, reason: string) => void;
}) {
  if (!take || take.status !== 'OPEN' || !Array.isArray(take.items)) return null;
  const items = take.items as Item[];
  const byId = new Map<string, Good>(goods.map(g => [String(g.id), g]));
  const missing = items.filter(item => !item.seen);
  const findings = ((take.findings || []) as Finding[]).filter(finding => finding.status === 'OPEN');
  const changed = items.filter(item => {
    const good = byId.get(item.goodId);
    return good !== undefined && good.version !== item.expectedVersion;
  });
  return <div className="panel">
    <h2>复核盘点差异</h2>
    <p>账面 {items.length} 件，未核对 {missing.length} 件，盘点期间流转后尚需重新核对 {changed.length} 件。</p>
    {missing.length > 0 && <div className="card"><strong>未见货品</strong><p>{missing.map(item => byId.get(item.goodId)?.code || item.goodId).join('、')}</p></div>}
    {changed.length > 0 && <div className="error">请先重新核对这些发生流转的货品：{changed.map(item => byId.get(item.goodId)?.code || item.goodId).join('、')}</div>}
    {findings.map(finding => <form className="form" key={finding.id} onSubmit={event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const disposition = String(fields.get('disposition') || '');
      const reason = String(fields.get('reason') || '').trim();
      if (reason) onResolve(finding.id, disposition, reason);
    }}>
      <strong className="span2">{finding.code} · {({ WRONG_LOCATION: '错位货', UNREGISTERED: '未登记货号', EXTRA: '快照外多货' } as Record<string, string>)[finding.kind] || finding.kind}</strong>
      <label>处理方式<select name="disposition" defaultValue={finding.kind === 'UNREGISTERED' ? 'IGNORE' : 'MOVE_HERE'} disabled={!canClose}><option value="MOVE_HERE">确认移入本位置</option><option value="IGNORE">核实后不纳入本次盘点</option></select></label>
      <label>处置说明<input name="reason" required minLength={4} disabled={!canClose} placeholder="说明实物与账面差异" /></label>
      {canClose && <button className="softbutton span2" type="submit">记录差异处置</button>}
    </form>)}
    {findings.length > 0 && <div className="error">还有 {findings.length} 项多货或错位差异，须先逐项复核。</div>}
    {canClose ? <form className="form" onSubmit={event => {
      event.preventDefault();
      const reason = String(new FormData(event.currentTarget).get('reason') || '').trim();
      if (reason) onClose(reason);
    }}>
      <label className="span2">老板复核说明<input name="reason" required minLength={4} placeholder="说明差异原因与处置依据" /></label>
      <button className="danger span2" type="submit" disabled={changed.length > 0 || findings.length > 0}>确认复核并结束盘点</button>
    </form> : <p className="muted">差异须由老板或获授权的复核人确认。</p>}
  </div>;
}
