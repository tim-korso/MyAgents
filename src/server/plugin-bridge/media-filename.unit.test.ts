import { describe, expect, it } from 'vitest';

import { sanitizeOutboundMediaFilename } from './media-filename';

describe('sanitizeOutboundMediaFilename', () => {
  it('preserves Unicode display filenames for outbound channel files', () => {
    expect(sanitizeOutboundMediaFilename('道路交通事故损害赔偿解释(二) 可视化看板.html')).toBe(
      '道路交通事故损害赔偿解释(二) 可视化看板.html',
    );
  });

  it('uses the basename and strips path traversal without ASCII-folding the name', () => {
    expect(sanitizeOutboundMediaFilename('../草稿/../../道路交通事故损害赔偿解释(二).html')).toBe(
      '道路交通事故损害赔偿解释(二).html',
    );
    expect(sanitizeOutboundMediaFilename('C:\\tmp\\合同?.pdf')).toBe('合同_.pdf');
  });

  it('removes filesystem-unsafe characters while keeping readable CJK text', () => {
    expect(sanitizeOutboundMediaFilename('赔偿<解释>:二|看板?.html')).toBe('赔偿_解释_二_看板_.html');
    expect(sanitizeOutboundMediaFilename('CON.txt')).toBe('_CON.txt');
    expect(sanitizeOutboundMediaFilename('报告. ')).toBe('报告');
    expect(sanitizeOutboundMediaFilename('...')).toBe('file');
  });

  it('normalizes decomposed Unicode names for stable macOS and Windows display', () => {
    expect(sanitizeOutboundMediaFilename('Cafe\u0301 可视化.html')).toBe('Café 可视化.html');
  });

  it('bounds the path component length without splitting UTF-8 characters or dropping the extension', () => {
    const safe = sanitizeOutboundMediaFilename(`${'可视化'.repeat(80)}.html`);

    expect(Buffer.byteLength(safe, 'utf8')).toBeLessThanOrEqual(180);
    expect(safe.endsWith('.html')).toBe(true);
    expect(safe.endsWith('. ')).toBe(false);
    expect(safe).toContain('可');
  });
});
