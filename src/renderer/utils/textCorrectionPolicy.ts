// Desktop text fields are primarily command, path, search, config, and prompt
// surfaces. System spellcheck/autocorrect popovers are noisy there, especially
// in macOS WKWebView, so renderer-owned editable controls opt out by default.

let globalCleanup: (() => void) | null = null;

const TEXT_CORRECTION_TARGET_SELECTOR = [
  'input',
  'textarea',
  '[contenteditable]',
].join(',');

const TEXT_CORRECTION_OPT_IN_SELECTOR = [
  '[data-text-correction="on"]',
  '[data-text-correction="true"]',
  '[data-text-correction="enabled"]',
].join(',');

const TEXTUAL_INPUT_TYPES = new Set([
  'email',
  'password',
  'search',
  'tel',
  'text',
  'url',
]);

export function installTextCorrectionPolicy(): void {
  if (globalCleanup) return;
  if (typeof document === 'undefined') return;
  globalCleanup = installTextCorrectionPolicyForDocument(document);
}

export function installTextCorrectionPolicyForDocument(doc: Document): () => void {
  applyTextCorrectionPolicy(doc);

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (target && (target as Node).nodeType === 1) {
      applyTextCorrectionPolicy(target as Element);
    }
  };

  doc.addEventListener('focusin', onFocusIn, { capture: true });

  const MutationObserverCtor = doc.defaultView?.MutationObserver;
  const observer = MutationObserverCtor
    ? new MutationObserverCtor((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes') {
            applyTextCorrectionPolicy(mutation.target as Element);
            continue;
          }
          for (const node of Array.from(mutation.addedNodes)) {
            if (node.nodeType === 1) {
              applyTextCorrectionPolicy(node as Element);
            }
          }
        }
      })
    : null;

  observer?.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['type', 'contenteditable', 'data-text-correction'],
  });

  return () => {
    doc.removeEventListener('focusin', onFocusIn, { capture: true });
    observer?.disconnect();
  };
}

export function applyTextCorrectionPolicy(root: ParentNode): void {
  const maybeElement = root as Element;
  if (typeof maybeElement.matches === 'function' && maybeElement.matches(TEXT_CORRECTION_TARGET_SELECTOR)) {
    disableTextCorrectionIfEditable(maybeElement);
  }

  for (const element of Array.from(root.querySelectorAll(TEXT_CORRECTION_TARGET_SELECTOR))) {
    disableTextCorrectionIfEditable(element);
  }
}

export function shouldDisableTextCorrection(element: Element): boolean {
  if (element.closest(TEXT_CORRECTION_OPT_IN_SELECTOR)) return false;

  const tagName = element.tagName.toLowerCase();
  if (tagName === 'textarea') return true;

  if (tagName === 'input') {
    const input = element as HTMLInputElement;
    return TEXTUAL_INPUT_TYPES.has(input.type.toLowerCase());
  }

  const contentEditable = element.getAttribute('contenteditable');
  return contentEditable !== null && contentEditable.toLowerCase() !== 'false';
}

function disableTextCorrectionIfEditable(element: Element): void {
  if (!shouldDisableTextCorrection(element)) return;
  element.setAttribute('spellcheck', 'false');
  element.setAttribute('autocorrect', 'off');
  element.setAttribute('autocapitalize', 'off');
}
