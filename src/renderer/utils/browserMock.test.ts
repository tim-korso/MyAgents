import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockAddProject, mockLoadProjects, mockSaveProjects } from './browserMock';

let storage: Record<string, string>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-24T01:02:03.000Z'));
  storage = {};
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage[key] = String(value);
    }),
    removeItem: vi.fn((key: string) => {
      delete storage[key];
    }),
    clear: vi.fn(() => {
      storage = {};
    }),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('mockAddProject', () => {
  it('deduplicates Windows path identity variants without rewriting the stored path', () => {
    const originalPath = 'C:\\Users\\Me\\Project';
    mockSaveProjects([{
      id: 'project-1',
      name: 'Project',
      path: originalPath,
      providerId: null,
      permissionMode: null,
      lastOpened: '2026-06-24T00:00:00.000Z',
    }]);

    const project = mockAddProject('c:/users/me/project/');

    expect(project.path).toBe(originalPath);
    expect(project.lastOpened).toBe('2026-06-24T01:02:03.000Z');
    expect(mockLoadProjects()).toHaveLength(1);
  });
});
