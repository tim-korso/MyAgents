import type { ComponentProps } from 'react';
import type { Root, Nodes } from 'mdast';
import type { VFile } from 'vfile';
import { defaultUrlTransform, type UrlTransform, type default as ReactMarkdown } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { fileUrlToPath } from './workspaceFileLinks';

/** Local references use the existing file scheme across the Markdown boundary.
 * Normalize drive spelling before sanitize, which otherwise sees C: as a scheme.
 * Micromark URL-encodes native backslashes; raw HTML keeps them literal. */
function normalizeMarkdownFileUrl(value: string): string | null {
  // A bare filename with a source location is otherwise parsed as a URI
  // scheme by sanitize (README.md:12). Make the relative path explicit.
  if (/^[^/\\:\s]+\.[^/\\:\s]+:\d+(?::\d+)?(?:#.*)?$/.test(value)) return `./${value}`;
  let candidate = value;
  if (/^[A-Za-z]:(?:[/\\]|%5c)/i.test(candidate)) {
    candidate = `file:///${candidate.replace(/%5c/ig, '/').replace(/\\/g, '/')}`;
  }
  if (!fileUrlToPath(candidate)) return null;
  return new URL(candidate).href;
}

/** Preserve the parser's native link spelling before mdast→hast URI encoding.
 * Metadata is local to this render's VFile; it never changes navigation policy. */
function remarkOriginalReferences() {
  return (tree: Root, file: VFile) => {
    const definitions = new Map<string, string>();
    const references = new Map<number, string>();
    const visit = (node: Nodes, action: (node: Nodes) => void) => {
      action(node);
      if ('children' in node) node.children.forEach(child => visit(child, action));
    };
    visit(tree, node => {
      if (node.type === 'definition' && !definitions.has(node.identifier.toUpperCase())) {
        definitions.set(node.identifier.toUpperCase(), node.url);
      }
    });
    visit(tree, node => {
      const url = node.type === 'link' ? node.url : node.type === 'linkReference' ? definitions.get(node.identifier.toUpperCase()) : undefined;
      const offset = node.position?.start.offset;
      if (url !== undefined && offset !== undefined) references.set(offset, url);
    });
    file.data.myagentsOriginalReferences = references;
  };
}

interface MarkdownNode {
  tagName?: string;
  position?: { start: { offset?: number } };
  data?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
}

function rehypeLocalFileReferences() {
  return (tree: MarkdownNode, file: VFile) => {
    const references = file.data.myagentsOriginalReferences as Map<number, string> | undefined;
    const visit = (node: MarkdownNode) => {
      const property = node.tagName === 'img' ? 'src' : node.tagName === 'a' ? 'href' : null;
      if (property && typeof node.properties?.[property] === 'string') {
        // Presentation/copy preserve the author's reference; only the href
        // used for navigation passes through normalization and sanitization.
        if (property === 'href') node.data = { ...node.data, originalHref: references?.get(node.position?.start.offset ?? -1) ?? node.properties[property] };
        const normalized = normalizeMarkdownFileUrl(node.properties[property]);
        if (normalized) node.properties[property] = normalized;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

/** Only the application-owned image/link consumers may retain valid file URLs.
 * Other schemes/attributes still follow ReactMarkdown's default URL policy. */
export const MARKDOWN_URL_TRANSFORM: UrlTransform = (value, key, node) => {
  if (((key === 'src' && node.tagName === 'img') || (key === 'href' && node.tagName === 'a'))
    && fileUrlToPath(value)) return value;
  return defaultUrlTransform(value);
};

// Sanitize schema: allow safe HTML tags from rehype-raw, strip scripts/iframes/event handlers.
// Extends the default GitHub-flavored schema with additional tags used in AI-generated content.
export const MARKDOWN_SANITIZE_SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'file'],
    src: [...(defaultSchema.protocols?.src ?? []), 'file'],
  },
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'details', 'summary',  // collapsible sections
    'mark', 'ins', 'del',  // text highlighting
    'sub', 'sup',           // subscript/superscript
    'kbd', 'var', 'samp',  // technical inline elements
  ],
  attributes: {
    ...defaultSchema.attributes,
    // Keep the default language-* class support for fenced code blocks.
    // Do not allow arbitrary class/style on raw HTML: AI/user Markdown can
    // otherwise render Tailwind or fixed-position overlay markup as live DOM.
    // KaTeX runs after this sanitizer, so its generated classes are unaffected.
    code: defaultSchema.attributes?.code ?? [],
  },
};

export const MARKDOWN_REMARK_PLUGINS_DEFAULT: ComponentProps<typeof ReactMarkdown>['remarkPlugins'] = [
  remarkGfm,
  remarkMath,
  remarkOriginalReferences,
];

export const MARKDOWN_REMARK_PLUGINS_WITH_BREAKS: ComponentProps<typeof ReactMarkdown>['remarkPlugins'] = [
  remarkGfm,
  remarkMath,
  remarkOriginalReferences,
  remarkBreaks,
];

export const MARKDOWN_REHYPE_PLUGINS: ComponentProps<typeof ReactMarkdown>['rehypePlugins'] = [
  rehypeRaw,
  rehypeLocalFileReferences,
  [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA],
  rehypeKatex,
];

/**
 * Convert YAML frontmatter (---\n...\n---) to a fenced yaml code block
 * so the existing CodeBlock component renders it with syntax highlighting.
 * Only applied in raw/file-preview mode where skill/agent .md files are displayed.
 */
export function convertFrontmatter(content: string): string {
  if (!content) return '';
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return content;
  const yamlBlock = '```yaml\n' + match[1] + '\n```\n';
  return yamlBlock + content.slice(match[0].length);
}
