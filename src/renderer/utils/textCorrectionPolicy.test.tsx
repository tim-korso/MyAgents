import { afterEach, describe, expect, it } from 'vitest';

import {
  applyTextCorrectionPolicy,
  installTextCorrectionPolicyForDocument,
  shouldDisableTextCorrection,
} from './textCorrectionPolicy';

function expectCorrectionDisabled(element: Element): void {
  expect(element.getAttribute('spellcheck')).toBe('false');
  expect(element.getAttribute('autocorrect')).toBe('off');
  expect(element.getAttribute('autocapitalize')).toBe('off');
}

describe('textCorrectionPolicy', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('disables correction attributes on text inputs, textareas, and editable content', () => {
    document.body.innerHTML = `
      <input id="plain">
      <input id="search" type="search">
      <textarea id="textarea"></textarea>
      <div id="editable" contenteditable="true"></div>
    `;

    applyTextCorrectionPolicy(document);

    expectCorrectionDisabled(document.getElementById('plain')!);
    expectCorrectionDisabled(document.getElementById('search')!);
    expectCorrectionDisabled(document.getElementById('textarea')!);
    expectCorrectionDisabled(document.getElementById('editable')!);
  });

  it('leaves non-textual inputs and explicit opt-ins alone', () => {
    document.body.innerHTML = `
      <input id="checkbox" type="checkbox">
      <input id="date" type="date">
      <input id="optIn" data-text-correction="on">
    `;

    applyTextCorrectionPolicy(document);

    expect(document.getElementById('checkbox')!.hasAttribute('autocorrect')).toBe(false);
    expect(document.getElementById('date')!.hasAttribute('autocorrect')).toBe(false);
    expect(document.getElementById('optIn')!.hasAttribute('autocorrect')).toBe(false);
  });

  it('applies to inputs added after installation', async () => {
    const cleanup = installTextCorrectionPolicyForDocument(document);
    const input = document.createElement('input');
    input.type = 'text';
    document.body.append(input);

    await Promise.resolve();

    expectCorrectionDisabled(input);
    cleanup();
  });

  it('matches the editable control policy', () => {
    const textInput = document.createElement('input');
    const numberInput = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    const nonEditable = document.createElement('div');

    textInput.type = 'text';
    numberInput.type = 'number';
    editable.setAttribute('contenteditable', 'plaintext-only');
    nonEditable.setAttribute('contenteditable', 'false');

    expect(shouldDisableTextCorrection(textInput)).toBe(true);
    expect(shouldDisableTextCorrection(numberInput)).toBe(false);
    expect(shouldDisableTextCorrection(textarea)).toBe(true);
    expect(shouldDisableTextCorrection(editable)).toBe(true);
    expect(shouldDisableTextCorrection(nonEditable)).toBe(false);
  });
});
