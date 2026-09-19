import { existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

const parser = unified().use(remarkParse);

// Parse Markdown instead of matching examples inside fenced/inline code.
// Only repository-local file targets are checked: external repositories,
// network URLs and fragment semantics require separate verification.
export function checkLocalDocLinks(root, file, markdown) {
  const tree = parser.parse(markdown);
  const definitions = new Map();
  const links = [];
  const failures = [];
  function visit(node) {
    if (node.type === 'definition' && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node.url);
    }
    if (node.type === 'link' || node.type === 'image'
      || node.type === 'linkReference' || node.type === 'imageReference') links.push(node);
    for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
  for (const link of links) {
    const url = link.url ?? definitions.get(link.identifier);
    if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) continue;
    const path = url.split(/[?#]/, 1)[0];
    if (!path) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      failures.push(`${file}:${link.position.start.line}: invalid URL encoding: ${url}`);
      continue;
    }
    const target = resolve(dirname(resolve(root, file)), decoded);
    const local = relative(root, target);
    if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) continue;
    if (!existsSync(target)) {
      failures.push(`${file}:${link.position.start.line}: missing local link target: ${url}`);
    }
  }
  return failures;
}
