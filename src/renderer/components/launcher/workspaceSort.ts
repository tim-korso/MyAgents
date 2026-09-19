import type { Project } from '@/config/types';

const timeValue = (value?: string): number => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const projectLabel = (project: Project): string =>
  (project.displayName || project.name || project.path).toLocaleLowerCase();

export const sortLauncherProjects = (projects: readonly Project[]): Project[] =>
  [...projects].sort((a, b) => {
    const aPinned = Boolean(a.pinnedAt);
    const bPinned = Boolean(b.pinnedAt);

    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }

    const aTime = aPinned ? timeValue(a.pinnedAt) : timeValue(a.lastOpened);
    const bTime = bPinned ? timeValue(b.pinnedAt) : timeValue(b.lastOpened);

    if (aTime !== bTime) {
      return bTime - aTime;
    }

    return projectLabel(a).localeCompare(projectLabel(b), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
