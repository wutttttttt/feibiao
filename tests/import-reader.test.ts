import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseImportFile } from '../src/lib/import-reader';

describe('表格导入预览解析', () => {
  it('UTF-8 CSV 保留引号内逗号，按表头映射字段', async () => {
    const csv = '\uFEFFexternalId,name,category,ownershipKind\nCSV-001,"白底青,挂件",挂件,OWN\n';
    const rows = await parseImportFile(new TextEncoder().encode(csv), 'goods.csv');
    expect(rows).toEqual([{ externalId: 'CSV-001', name: '白底青,挂件', category: '挂件', ownershipKind: 'OWN' }]);
  });

  it('XLSX 从首张工作表读取演示货品', async () => {
    const rows = await parseImportFile(readFileSync('tests/fixtures/goods.xlsx'), 'goods.xlsx');
    expect(rows).toEqual([{ externalId: 'XLSX-001', name: '测试翠件', category: '挂件', ownershipKind: 'OWN' }]);
  });

  it('拒绝重复或危险表头与伪装格式', async () => {
    await expect(parseImportFile(new TextEncoder().encode('name,name\na,b'), 'goods.csv')).rejects.toMatchObject({ status: 400 });
    await expect(parseImportFile(new TextEncoder().encode('__proto__,name\na,b'), 'goods.csv')).rejects.toMatchObject({ status: 400 });
    await expect(parseImportFile(new TextEncoder().encode('x'), 'goods.xls')).rejects.toMatchObject({ status: 400 });
    await expect(parseImportFile(new TextEncoder().encode('not a zip'), 'goods.xlsx')).rejects.toMatchObject({ status: 400 });
  });
});
