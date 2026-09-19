import type { EditorState } from '@codemirror/state';
import { markdownTableSnapshot } from '@/utils/markdownTableExport';

/** The document is authoritative, not the virtual DOM or a still-partial CM parse.
 * Parse on explicit export only; source offsets select exactly this table and
 * document-level reference definitions remain available to the shared pipeline. */
export function editorTableSnapshot(state: EditorState, position: number) {
  return markdownTableSnapshot(state.doc.toString(), position);
}
