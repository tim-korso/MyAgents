import type { SpaceSkillFile } from '@/api/spaceCloud';

export interface SpaceSkillFileTreeRow {
  file: SpaceSkillFile;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
}

function sortSkillFileSiblings(files: SpaceSkillFile[]): SpaceSkillFile[] {
  return [...files].sort((left, right) => {
    if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
    return left.name.localeCompare(right.name) || left.path.localeCompare(right.path);
  });
}

function fallbackDepth(file: SpaceSkillFile): number {
  return Math.max(0, file.path.split('/').length - 1);
}

export function createSkillFileTreeRows(
  files: SpaceSkillFile[],
  expandedPaths: ReadonlySet<string>,
): SpaceSkillFileTreeRow[] {
  const childrenByParent = new Map<string, SpaceSkillFile[]>();
  const filesByPath = new Map<string, SpaceSkillFile>();
  for (const file of files) {
    filesByPath.set(file.path, file);
    const parentPath = file.parentPath || '';
    const children = childrenByParent.get(parentPath) ?? [];
    children.push(file);
    childrenByParent.set(parentPath, children);
  }

  const rows: SpaceSkillFileTreeRow[] = [];
  const visited = new Set<string>();

  const visit = (parentPath: string, depth: number) => {
    const children = sortSkillFileSiblings(childrenByParent.get(parentPath) ?? []);
    for (const file of children) {
      if (visited.has(file.path)) continue;
      visited.add(file.path);
      const hasChildren = file.isDir && (childrenByParent.get(file.path)?.length ?? 0) > 0;
      const isExpanded = hasChildren && expandedPaths.has(file.path);
      rows.push({ file, depth, hasChildren, isExpanded });
      if (isExpanded) visit(file.path, depth + 1);
    }
  };

  visit('', 0);

  for (const file of sortSkillFileSiblings(files)) {
    if (visited.has(file.path)) continue;
    if (file.parentPath && filesByPath.has(file.parentPath)) continue;
    visited.add(file.path);
    const hasChildren = file.isDir && (childrenByParent.get(file.path)?.length ?? 0) > 0;
    rows.push({
      file,
      depth: fallbackDepth(file),
      hasChildren,
      isExpanded: hasChildren && expandedPaths.has(file.path),
    });
  }

  return rows;
}
