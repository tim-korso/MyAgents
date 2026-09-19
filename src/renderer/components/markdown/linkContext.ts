import { createContext } from 'react';

// An explicit anchor owns its destination; formatting in its label cannot
// infer a second interactive file target.
export const MarkdownLinkLabelContext = createContext(false);
export const MarkdownDocumentDirectoryContext = createContext('');
