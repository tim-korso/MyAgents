import { describe, expect, it } from 'vitest';

import { isExternalUrl, isFilePath, toLocalFilePath } from './openExternal';

describe('toLocalFilePath', () => {
    describe('file:// URLs', () => {
        it('decodes a Unix file URL pathname', () => {
            expect(toLocalFilePath('file:///Users/foo/bar.html')).toBe('/Users/foo/bar.html');
        });

        it('decodes percent-encoded characters', () => {
            expect(toLocalFilePath('file:///Users/foo/path%20with%20space/x.html'))
                .toBe('/Users/foo/path with space/x.html');
        });

        it('strips the leading slash on Windows drive paths and normalizes separators', () => {
            expect(toLocalFilePath('file:///C:/foo/bar.html')).toBe('C:\\foo\\bar.html');
        });

        it('handles uppercase scheme prefix', () => {
            expect(toLocalFilePath('FILE:///Users/foo/bar.html')).toBe('/Users/foo/bar.html');
        });

        it('passes the bare-root "/" through for file:// (Rust rejects it via home/tmp prefix)', () => {
            // `new URL('file://')` succeeds with pathname '/'. We don't try
            // to second-guess that here — the Rust validator (home/tmp
            // prefix + credential blacklist) is the safety net.
            expect(toLocalFilePath('file://')).toBe('/');
        });

        it('returns null for a malformed file URL', () => {
            // URL parser throws on `file://[` (invalid host token).
            expect(toLocalFilePath('file://[invalid')).toBeNull();
        });
    });

    describe('absolute filesystem paths', () => {
        it('returns Unix absolute path unchanged', () => {
            expect(toLocalFilePath('/Users/foo/bar.html')).toBe('/Users/foo/bar.html');
        });

        it('returns Windows backslash path unchanged', () => {
            expect(toLocalFilePath('C:\\Users\\foo\\bar.html')).toBe('C:\\Users\\foo\\bar.html');
        });

        it('returns Windows forward-slash path unchanged', () => {
            expect(toLocalFilePath('C:/Users/foo/bar.html')).toBe('C:/Users/foo/bar.html');
        });
    });

    describe('non-file targets pass through (return null)', () => {
        it.each([
            ['https://example.com/foo'],
            ['http://example.com/foo'],
            ['mailto:user@example.com'],
            ['tel:+15551234567'],
            ['data:text/html;charset=utf-8,%3Chtml%3E%3C%2Fhtml%3E'],
            ['blob:https://example.com/abc-123'],
            ['about:blank'],
            ['javascript:alert(1)'],
            ['relative/path/file.html'],
            ['./foo.html'],
            ['../foo.html'],
            ['foo.html'],
            [''],
        ])('returns null for %s', (input) => {
            expect(toLocalFilePath(input)).toBeNull();
        });
    });
});

describe('isExternalUrl', () => {
    it('matches http/https/mailto', () => {
        expect(isExternalUrl('http://example.com')).toBe(true);
        expect(isExternalUrl('https://example.com')).toBe(true);
        expect(isExternalUrl('mailto:user@example.com')).toBe(true);
    });

    it('rejects non-URL or local schemes', () => {
        expect(isExternalUrl('file:///foo')).toBe(false);
        expect(isExternalUrl('/foo/bar')).toBe(false);
        expect(isExternalUrl('about:blank')).toBe(false);
        expect(isExternalUrl('')).toBe(false);
    });
});

describe('isFilePath', () => {
    it('matches Unix absolute, Windows backslash, and home-prefixed paths', () => {
        expect(isFilePath('/foo/bar')).toBe(true);
        expect(isFilePath('C:\\foo')).toBe(true);
        expect(isFilePath('~/foo')).toBe(true);
    });

    it('rejects relative paths and URLs', () => {
        expect(isFilePath('foo/bar')).toBe(false);
        expect(isFilePath('./foo')).toBe(false);
        expect(isFilePath('https://example.com')).toBe(false);
        expect(isFilePath('')).toBe(false);
    });
});
