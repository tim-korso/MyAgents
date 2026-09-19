import { useRef } from 'react';
import { useTableIntrinsicSizing } from './useTableIntrinsicSizing';
import type { Components } from 'react-markdown';
import TableActions from './TableActions';
import { tableSnapshotFromHast } from '@/utils/tableExport';

const MarkdownTable: Components['table'] = ({ children, node }) => {
  const tableRef = useRef<HTMLTableElement>(null);
  useTableIntrinsicSizing(tableRef);
  return (
  <div className="markdown-table max-w-full">
    <div className="markdown-table-scroll overflow-x-auto rounded-lg border border-[var(--line)]">
      <table ref={tableRef} className="m-0 min-w-full divide-y divide-[var(--line)]">{children}</table>
    </div>
    {node && <TableActions getSnapshot={() => tableSnapshotFromHast(node)} />}
  </div>
  );
};
export default MarkdownTable;
