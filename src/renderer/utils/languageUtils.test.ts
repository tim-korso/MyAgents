import { describe, expect, it } from 'vitest';

import {
  getEditorMonacoLanguage,
  hasPathologicallyLongLine,
  MONACO_TOKENIZATION_BYTE_BUDGET,
  PATHOLOGICAL_LINE_LENGTH,
} from './languageUtils';

describe('languageUtils — editor Monaco language budget', () => {
  it('keeps known source files highlighted under the 1MB tokenization budget', () => {
    const content = 'import { useEffect } from "react";\nexport const x = 1;\n';

    expect(getEditorMonacoLanguage('TabProvider.tsx', content, 230_782)).toBe(
      'typescript',
    );
  });

  it('downgrades known source files over the tokenization budget to plaintext', () => {
    const content = 'const x = 1;\n';

    expect(
      getEditorMonacoLanguage(
        'large.ts',
        content,
        MONACO_TOKENIZATION_BYTE_BUDGET + 1,
      ),
    ).toBe('plaintext');
  });

  it('downgrades pathologically long single-line content even when the extension is known', () => {
    const content = `const payload = "${'x'.repeat(PATHOLOGICAL_LINE_LENGTH + 1)}";`;

    expect(hasPathologicallyLongLine(content)).toBe(true);
    expect(getEditorMonacoLanguage('bundle.js', content, content.length)).toBe(
      'plaintext',
    );
  });

  it('keeps unknown and plain-text classes out of Monaco tokenization', () => {
    expect(getEditorMonacoLanguage('session.log', 'INFO ready\n', 11)).toBe(
      'plaintext',
    );
    expect(getEditorMonacoLanguage('data.jsonl', '{"a":1}\n', 8)).toBe(
      'plaintext',
    );
    expect(getEditorMonacoLanguage('notes.txt', 'hello\n', 6)).toBe(
      'plaintext',
    );
  });
});
