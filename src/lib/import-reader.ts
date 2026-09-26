import { readSheet } from 'read-excel-file/node';
import { parse } from 'csv-parse/sync';
import { AppError } from './auth';

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new AppError(400, '表格包含无法读取的单元格');
}

export async function parseImportFile(bytes: Uint8Array, filename: string): Promise<Record<string, string>[]> {
  const extension = filename.toLowerCase().split('.').pop();
  let matrix: unknown[][];
  try {
    if (extension === 'xlsx') {
      matrix = await readSheet(Buffer.from(bytes));
    } else if (extension === 'csv') {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      matrix = parse(source, { bom: true, skip_empty_lines: true, relax_column_count: true, max_record_size: 100_000 }) as string[][];
    } else {
      throw new AppError(400, '只支持 CSV 或 XLSX 文件');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, extension === 'csv' ? 'CSV 文件须使用 UTF-8 编码且格式正确' : 'XLSX 文件格式无效或已损坏');
  }
  if (matrix.length < 2) throw new AppError(400, '表格至少需要表头和一行数据');
  if (matrix.length > 2001) throw new AppError(400, '单次最多导入2000行');
  const headers = matrix[0].map(value => cellText(value).trim());
  if (!headers.length || headers.length > 80 || headers.some(header => !header || ['__proto__', 'constructor', 'prototype'].includes(header)) || new Set(headers).size !== headers.length) {
    throw new AppError(400, '表头为空、重复或包含无效列名');
  }
  return matrix.slice(1).filter(row => row.some(value => cellText(value).trim())).map((row, index) => {
    if (row.length > headers.length && row.slice(headers.length).some(value => cellText(value).trim())) {
      throw new AppError(400, `第${index + 2}行比表头多出数据列`);
    }
    const record: Record<string, string> = Object.create(null);
    headers.forEach((header, column) => { record[header] = cellText(row[column]); });
    return record;
  });
}
