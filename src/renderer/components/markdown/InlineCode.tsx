import ContentLink from './ContentLink';

/** Extract plain text from React children (handles string / number / nested spans). */
function extractText(node: React.ReactNode): string {
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(extractText).join('');
    if (node && typeof node === 'object' && 'props' in node) {
        return extractText((node as { props: { children?: React.ReactNode } }).props.children);
    }
    return '';
}

export default function InlineCode({ children }: { children: React.ReactNode }) {
    return <ContentLink native reference={extractText(children)}>{children}</ContentLink>;
}
