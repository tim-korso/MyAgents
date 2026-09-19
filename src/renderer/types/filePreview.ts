export interface FilePreviewFocusTarget {
  /** Source-local navigation event id. Same line can be focused repeatedly. */
  requestId: number;
  lineNumber: number;
  query?: string;
  highlights?: [number, number][];
}
