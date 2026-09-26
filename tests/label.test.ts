import { describe, expect, it } from 'vitest';
import { labelDocument } from '../src/lib/label';

describe('货品标签', () => {
  it('提供多种热敏标签尺寸并通过系统打印窗口选择打印机', () => {
    const html = labelDocument({ code: 'FC20260926-ABC', name: '翡翠手镯' }, '<svg id="barcode"></svg>');
    for (const size of ['70x40', '60x40', '50x30', '40x30']) expect(html).toContain(`value="${size}"`);
    expect(html).toContain('window.print()');
    expect(html).toContain('<svg id="barcode"></svg>');
    expect(html).toContain('FC20260926-ABC');
  });

  it('货品名称和货号不会插入可执行标记', () => {
    const html = labelDocument({ code: 'A<1', name: '<script>alert(1)</script>' }, '<svg></svg>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('A&lt;1');
  });
});
