import { useCallback, useMemo, useRef, useState } from 'react';

import { spaceInspectAttachmentDrafts, type SpaceAttachmentDraft } from '@/api/spaceCloud';

const MAX_DRAFTS = 5;

export function useSpaceAttachmentDrafts(onLimit: () => void) {
  const [drafts, setDrafts] = useState<SpaceAttachmentDraft[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const generationRef = useRef(0);

  const addPaths = useCallback(async (paths: string[]) => {
    const existing = new Set(drafts.map(item => item.path));
    const unique = paths.filter(path => path.trim() && !existing.has(path));
    const remaining = Math.max(0, MAX_DRAFTS - drafts.length);
    if (unique.length > remaining) onLimit();
    const accepted = unique.slice(0, remaining);
    if (accepted.length === 0) return;
    const generation = generationRef.current;
    setPendingCount(current => current + 1);
    try {
      const inspected = await spaceInspectAttachmentDrafts(accepted);
      if (generation !== generationRef.current) return;
      setDrafts(current => {
        const currentPaths = new Set(current.map(item => item.path));
        return [...current, ...inspected.filter(item => !currentPaths.has(item.path))].slice(0, MAX_DRAFTS);
      });
    } finally {
      setPendingCount(current => Math.max(0, current - 1));
    }
  }, [drafts, onLimit]);

  const remove = useCallback((path: string) => {
    setDrafts(current => current.filter(item => item.path !== path));
  }, []);
  const clear = useCallback(() => {
    generationRef.current += 1;
    setDrafts([]);
  }, []);

  return {
    drafts,
    pending: pendingCount > 0,
    filePaths: useMemo(() => drafts.map(item => item.path), [drafts]),
    addPaths,
    remove,
    clear,
    replace: setDrafts,
  };
}
