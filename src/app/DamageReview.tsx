'use client';

type Damage = Record<string, any>;
type Good = Record<string, any>;

export default function DamageReview({ damages, goods, canView, canReview, onReview }: {
  damages: Damage[];
  goods: Good[];
  canView: boolean;
  canReview: boolean;
  onReview: (id: string, body: { disposition: string; responsibility: string; reason: string; imageId?: string }) => void;
}) {
  if (!canView) return null;
  const open = damages.filter(d => !d.resolvedAt);
  const byId = new Map(goods.map(g => [g.id, g]));
  return <div className="section"><h2>异常货与货损</h2>
    <p className="muted">待处理 {open.length} 件。责任确认只留记录，不自动向客户或上游扣款；凭证照片可先在货品详情上传。</p>
    {open.length === 0 && <div className="empty">暂无待处理异常货。</div>}
    {open.map(d => <div className="panel" key={d.id}>
      <h3>{d.good.code} · {d.good.name}</h3><p>{d.description}</p>
      {d.photoFile && <img className="thumb" src={`/api/media/${d.photoFile}`} alt="货损凭证" />}
      {d.resolution && <p className="muted">上次复核：{d.resolution}</p>}
      {canReview ? <form className="form" onSubmit={event => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const reason = String(fields.get('reason') || '').trim();
        if (reason) onReview(d.id, {
          disposition: String(fields.get('disposition') || ''),
          responsibility: String(fields.get('responsibility') || ''),
          reason,
          imageId: String(fields.get('imageId') || '') || undefined,
        });
      }}>
        <label>责任归属<select name="responsibility" defaultValue={d.responsibility}><option value="UNCONFIRMED">尚未确认</option><option value="CUSTOMER">客户</option><option value="UPSTREAM">上游货主</option><option value="MERCHANT">本摊</option><option value="OTHER">其他</option></select></label>
        <label>处置结果<select name="disposition" defaultValue="KEEP_HOLD"><option value="KEEP_HOLD">继续待处理</option><option value="RESTORE">已修复，恢复可售</option><option value="WRITE_OFF">确认报损，继续不可售</option></select></label>
        <label>凭证照片<select name="imageId" defaultValue=""><option value="">未关联新照片</option>{(byId.get(d.goodId)?.images || []).map((image: { id: string }) => <option key={image.id} value={image.id}>{image.id.slice(0, 8)}</option>)}</select></label>
        <label>复核说明<input name="reason" required minLength={4} placeholder="描述检查结果和处置依据" /></label>
        <button className="primary span2" type="submit">记录老板复核</button>
      </form> : <p className="muted">请老板复核并处置。</p>}
    </div>)}
  </div>;
}
