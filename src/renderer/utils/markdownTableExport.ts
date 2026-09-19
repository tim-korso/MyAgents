import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { MARKDOWN_REMARK_PLUGINS_DEFAULT, MARKDOWN_REHYPE_PLUGINS } from './markdownPipeline';
import { tableSnapshotFromHast, type TableExportNode } from './tableExport';

// Same parser/plugins as ReactMarkdown, invoked only for an editor export action.
const processor = unified().use(remarkParse).use(MARKDOWN_REMARK_PLUGINS_DEFAULT ?? [])
  .use(remarkRehype, { allowDangerousHtml: true }).use(MARKDOWN_REHYPE_PLUGINS ?? []);
export function markdownTableSnapshot(source: string, position?: number) {
  const root = processor.runSync(processor.parse(source)) as TableExportNode;
  const find = (node: TableExportNode): TableExportNode | undefined => {
    if (node.tagName === 'table' && (position === undefined ||
      (node.position?.start.offset !== undefined && node.position.end.offset !== undefined &&
        node.position.start.offset <= position && position < node.position.end.offset))) return node;
    for (const child of node.children ?? []) { const match = find(child); if (match) return match; }
  };
  const table = find(root);
  if (!table) throw new Error('Table is no longer available');
  return tableSnapshotFromHast(table);
}
