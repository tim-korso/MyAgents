import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { markdownTableSnapshot } from './markdownTableExport';
import { tableTsv, tableXlsx } from './tableExport';

describe('portable Markdown table snapshot', () => {
  it('exports only the table with semantic inline HTML, alignment and TSV cells', () => {
    const data = markdownTableSnapshot('Outside\n\n| Name | Value |\n| :-- | --: |\n| **bold** & `code` | a<br>b |\n| [link](https://example.com) | a\\|b |\n\nAfter');
    expect(data.rows).toEqual([['Name', 'Value'], ['bold & code', 'a\nb'], ['link', 'a|b']]);
    expect(data.html).toContain('<strong>bold</strong> &amp; <code>code</code>');
    expect(data.html).toContain('text-align:right');
    expect(data.html).toContain('<a href="https://example.com">link</a>');
    expect(data.html).not.toMatch(/Outside|After|button/);
    expect(data.text).toBe('Name\tValue\r\nbold & code\t"a\nb"\r\nlink\ta|b');
    expect(tableTsv([['a\tb', '"x"']])).toBe('"a\tb"\t"""x"""');
  });
  it('does not export active markup or local resource links', () => {
    const data = markdownTableSnapshot('| Value |\n| --- |\n| <script>alert(1)</script>[local](file:///tmp/a) ![image](https://example.com/a.png) |');
    expect(data.html).not.toMatch(/script|file:|<img|onerror/);
    expect(data.rows[1][0]).toContain('local image');
  });
  it('writes an actual xlsx preserving strings and formula-looking values', async () => {
    const data = markdownTableSnapshot('| ID | Value |\n| --- | --- |\n| 00123 | =1+1 |\n| 12345678901234567890 | 2026-09-13 |');
    const blob = await tableXlsx(data);
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
    const sheet = XLSX.read(bytes, { type: 'array' }).Sheets.Table;
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toEqual(data.rows);
    expect(sheet.A2).toMatchObject({ t: 's', v: '00123' });
    expect(sheet.B2).toMatchObject({ t: 's', v: '=1+1' });
    expect(sheet.B2.f).toBeUndefined();
  });
});
