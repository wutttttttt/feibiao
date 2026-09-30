'use client';

import { useEffect, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { labelDocument } from '@/lib/label';

export default function LabelPreview({ good }: { good: { code: string; name: string } }) {
  const [documentHtml, setDocumentHtml] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    try {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      JsBarcode(svg, good.code, { format: 'CODE128', width: 2, height: 65, displayValue: false, margin: 10 });
      setDocumentHtml(labelDocument(good, svg.outerHTML));
    } catch {
      setError('该货号无法生成条码，请使用英文字母、数字或常见符号作为货号');
    }
  }, [good.code, good.name]);
  return <main style={{ maxWidth: 900, margin: 'auto', padding: 20 }}>
    <div className="row between"><div><h1 style={{ marginBottom: 4 }}>打印货品标签</h1><p className="muted">{good.code} · {good.name}</p></div><a className="softbutton" href="/">返回系统</a></div>
    {error && <p className="error">{error}</p>}
    {documentHtml && <iframe title="标签预览与打印" srcDoc={documentHtml} style={{ width: '100%', minHeight: 580, border: '1px solid rgba(11,59,51,.12)', borderRadius: 14, background: 'white' }} />}
  </main>;
}
