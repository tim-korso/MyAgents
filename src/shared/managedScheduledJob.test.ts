import { describe, expect, it } from 'vitest';

import {
  isManagedScheduledJob,
  isSystemMaintenanceSession,
  normalizeManagedScheduledJobKind,
  normalizeSystemMaintenanceKind,
} from './managedScheduledJob';

describe('managedScheduledJob', () => {
  it('normalizes managed scheduled job kinds from strings and object shapes', () => {
    expect(normalizeManagedScheduledJobKind('memory_gardener')).toBe('memory_gardener');
    expect(normalizeManagedScheduledJobKind({ managedKind: 'memory_molt' })).toBe('memory_molt');
    expect(normalizeManagedScheduledJobKind({ managed_kind: 'memory_auto_update_batch' })).toBe('memory_auto_update_batch');
    expect(isManagedScheduledJob({ managedKind: ' memory_gardener ' })).toBe(true);
  });

  it('rejects unknown or empty managed job markers', () => {
    expect(isManagedScheduledJob({ managedKind: 'user_task' })).toBe(false);
    expect(isManagedScheduledJob({ managedKind: ' ' })).toBe(false);
    expect(isManagedScheduledJob({})).toBe(false);
  });

  it('limits system maintenance sessions to gardener and molt', () => {
    expect(normalizeSystemMaintenanceKind({ systemMaintenanceKind: 'memory_gardener' })).toBe('memory_gardener');
    expect(normalizeSystemMaintenanceKind({ system_maintenance_kind: 'memory_molt' })).toBe('memory_molt');
    expect(isSystemMaintenanceSession({ systemMaintenanceKind: 'memory_auto_update_batch' })).toBe(false);
    expect(isSystemMaintenanceSession({ origin: { kind: 'automation', surface: 'cron' } })).toBe(false);
  });
});
