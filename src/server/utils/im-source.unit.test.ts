import { describe, expect, it } from 'vitest';

import { isImSourcedSession, shouldDropSnapshotPatchOnImSession } from './im-source';

describe('isImSourcedSession (#305 PATCH guard)', () => {
  it('returns false for desktop sessions (always snapshot-eligible)', () => {
    expect(isImSourcedSession('desktop')).toBe(false);
  });

  it('returns false for missing source (legacy session, snapshot-eligible)', () => {
    expect(isImSourcedSession(undefined)).toBe(false);
    expect(isImSourcedSession(null)).toBe(false);
    expect(isImSourcedSession('')).toBe(false);
  });

  it('returns true for built-in IM platform sources', () => {
    expect(isImSourcedSession('feishu_private')).toBe(true);
    expect(isImSourcedSession('feishu_group')).toBe(true);
    expect(isImSourcedSession('telegram_private')).toBe(true);
    expect(isImSourcedSession('dingtalk_group')).toBe(true);
  });

  it('returns true for OpenClaw / bridge plugin channels following the convention', () => {
    expect(isImSourcedSession('discord_private')).toBe(true);
    expect(isImSourcedSession('wechat_group')).toBe(true);
    expect(isImSourcedSession('slack_group')).toBe(true);
  });

  it('returns false for non-IM-shaped sources (cron, api, etc.)', () => {
    expect(isImSourcedSession('cron')).toBe(false);
    expect(isImSourcedSession('api')).toBe(false);
    expect(isImSourcedSession('background_agent')).toBe(false);
  });
});

describe('shouldDropSnapshotPatchOnImSession (#305 PATCH /sessions/:id guard)', () => {
  // v0.2.39 retires the old pure-IM drop guard. A desktop PATCH means the
  // desktop Tab is now an owner, so even an IM-sourced session can acquire a
  // snapshot. Keep this test around to prevent future edits from restoring the
  // old "source suffix implies drop" behavior.

  it('returns false when no existing metadata (PATCH will 404 anyway)', () => {
    expect(shouldDropSnapshotPatchOnImSession(null)).toBe(false);
    expect(shouldDropSnapshotPatchOnImSession(undefined)).toBe(false);
  });

  it('returns false for desktop sessions (snapshot always writeable)', () => {
    expect(shouldDropSnapshotPatchOnImSession({
      source: 'desktop',
      configSnapshotAt: '2026-06-04T00:00:00.000Z',
    })).toBe(false);
    expect(shouldDropSnapshotPatchOnImSession({
      source: 'desktop',
      configSnapshotAt: null,
    })).toBe(false);
  });

  it('returns false for PURE-IM sessions: desktop PATCH promotes them to owned', () => {
    expect(shouldDropSnapshotPatchOnImSession({
      source: 'feishu_private',
      configSnapshotAt: null,
    })).toBe(false);
    expect(shouldDropSnapshotPatchOnImSession({
      source: 'telegram_group',
      configSnapshotAt: undefined,
    })).toBe(false);
  });

  it('returns false for desktop-to-IM HANDOVER sessions (IM source + configSnapshotAt set, PRD 0.2.14)', () => {
    // The handover session: desktop creation stamped configSnapshotAt, then the
    // user handed the session over to a feishu channel which flipped source.
    // IM bridge reads "snapshot wins" on delivery, so a Tab editing this
    // session MUST be able to update the snapshot.
    expect(shouldDropSnapshotPatchOnImSession({
      source: 'feishu_private',
      configSnapshotAt: '2026-06-04T00:00:00.000Z',
    })).toBe(false);
    expect(shouldDropSnapshotPatchOnImSession({
      source: 'dingtalk_group',
      configSnapshotAt: '2026-06-04T00:00:00.000Z',
    })).toBe(false);
  });

  it('returns false for legacy sessions with no source', () => {
    // Pre-v0.1.69. PATCH will lazily stamp configSnapshotAt on first write.
    expect(shouldDropSnapshotPatchOnImSession({
      source: undefined,
      configSnapshotAt: null,
    })).toBe(false);
  });
});
