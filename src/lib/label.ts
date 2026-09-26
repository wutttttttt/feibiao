type LabelGood = { code: string; name: string };

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function labelDocument(good: LabelGood, barcodeSvg: string) {
  const code = escapeHtml(good.code);
  const name = escapeHtml(good.name);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>货品标签 ${code}</title>
<style id="paper-style">@page{size:70mm 40mm;margin:0}.label{width:70mm;height:40mm}</style>
<style>
*{box-sizing:border-box}body{margin:0;color:#111;font-family:Arial,"Microsoft YaHei",sans-serif;background:#eef2ef}
.toolbar{padding:18px;background:#fff;border-bottom:1px solid #ddd;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.toolbar button,.toolbar select{font:16px sans-serif;padding:8px 12px}.toolbar p{flex-basis:100%;margin:0;color:#555;font-size:13px}
.sheet{padding:28px}.label{background:white;padding:3mm;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;break-inside:avoid}
.name{font-size:12pt;font-weight:700;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.code{font-size:10pt;font-weight:700;letter-spacing:.2px;white-space:nowrap}
.barcode{width:100%;height:17mm;display:flex;align-items:center;justify-content:center}.barcode svg{width:100%;height:100%;max-width:100%}
@media print{body{background:white}.toolbar{display:none}.sheet{padding:0}.label{margin:0;box-shadow:none}}
</style></head><body><div class="toolbar"><strong>货品标签</strong><label>标签纸尺寸 <select id="size" onchange="setSize()"><option value="70x40">70 × 40 mm</option><option value="60x40">60 × 40 mm</option><option value="50x30">50 × 30 mm</option><option value="40x30">40 × 30 mm</option></select></label><button type="button" onclick="window.print()">选择打印机并打印</button><p>在打印窗口选择已安装的 USB、蓝牙或 Wi-Fi 标签打印机；纸张尺寸与这里一致，缩放设为 100%，关闭页眉页脚。较窄标签请先试打一张并扫码核对。</p></div>
<div class="sheet"><div class="label"><div class="name">${name}</div><div class="barcode">${barcodeSvg}</div><div class="code">${code}</div></div></div>
<script>function setSize(){var v=document.getElementById('size').value.split('x');document.getElementById('paper-style').textContent='@page{size:'+v[0]+'mm '+v[1]+'mm;margin:0}.label{width:'+v[0]+'mm;height:'+v[1]+'mm}'}</script></body></html>`;
}
