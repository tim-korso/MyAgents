import { describe, it, expect } from 'vitest';

import { parseSessionIdQuery } from './parseSessionIdQuery';

const UUID = '6ef8118a-abef-4c61-8b84-0f08e14a25b9';

describe('parseSessionIdQuery', () => {
    it('parses a bare UUID', () => {
        expect(parseSessionIdQuery(UUID)).toBe(UUID);
    });

    it('parses the copy-button format "SessionID: <uuid>"', () => {
        expect(parseSessionIdQuery(`SessionID: ${UUID}`)).toBe(UUID);
    });

    it('tolerates surrounding whitespace / newlines from paste', () => {
        expect(parseSessionIdQuery(`  ${UUID}\n`)).toBe(UUID);
        expect(parseSessionIdQuery(`  SessionID:   ${UUID}  `)).toBe(UUID);
    });

    it('is case-insensitive on both label and uuid, and normalizes to lowercase', () => {
        expect(parseSessionIdQuery(`sessionid: ${UUID.toUpperCase()}`)).toBe(UUID);
        expect(parseSessionIdQuery(`Session Id : ${UUID}`)).toBe(UUID);
    });

    it('accepts a full-width colon (：)', () => {
        expect(parseSessionIdQuery(`SessionID：${UUID}`)).toBe(UUID);
    });

    it('does NOT hijack content searches that merely contain a uuid', () => {
        expect(parseSessionIdQuery(`error in ${UUID} happened`)).toBeNull();
        expect(parseSessionIdQuery(`${UUID} extra`)).toBeNull();
    });

    it('returns null for non-id queries', () => {
        expect(parseSessionIdQuery('目前分支情况')).toBeNull();
        expect(parseSessionIdQuery('')).toBeNull();
        expect(parseSessionIdQuery('   ')).toBeNull();
        expect(parseSessionIdQuery('not-a-uuid-1234')).toBeNull();
    });

    it('rejects a malformed uuid (wrong segment lengths)', () => {
        expect(parseSessionIdQuery('6ef8118a-abef-4c61-8b84-0f08e14a25b')).toBeNull(); // last seg short
        expect(parseSessionIdQuery('SessionID: 1234')).toBeNull();
    });
});
