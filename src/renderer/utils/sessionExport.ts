/**
 * Export a session's full message history as a downloadable Markdown file.
 *
 * Shared by SessionHistoryDropdown's per-row export action and the in-Chat
 * session menu (SessionMenuButton). Returns a result object so the caller
 * can drive its own toast / spinner.
 */

import { getSessionDetails } from '@/api/sessionClient';
import { i18n } from '@/i18n';
import { localDateStr, sanitizeFileName, downloadMarkdown, exportHeader } from '@/utils/markdownExport';

export interface SessionExportResult {
    ok: boolean;
    /** Pre-formatted toast message (success: download path; failure: reason) */
    message: string;
    /** True when the session existed but had no exportable content */
    empty?: boolean;
}

/** Extract text from assistant message stored as JSON content blocks. */
function extractAssistantText(content: string): string {
    try {
        const blocks = JSON.parse(content);
        if (!Array.isArray(blocks)) return content;
        return blocks
            .filter((b: { type: string }) => b.type === 'text')
            .map((b: { text: string }) => b.text)
            .join('\n\n');
    } catch {
        return content;
    }
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function sessionExportText(key: string): string {
    return String(i18n.t(`app:sessionExport.${key}`));
}

function fmtTs(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export async function exportSessionAsMarkdown(sessionId: string): Promise<SessionExportResult> {
    try {
        const data = await getSessionDetails(sessionId);
        if (!data || data.messages.length === 0) {
            return { ok: false, message: sessionExportText('empty'), empty: true };
        }

        const dateStr = localDateStr();

        const lines: string[] = [];
        lines.push(exportHeader(dateStr));
        lines.push(`<!-- Session: ${data.title} -->`);
        lines.push('');

        for (const msg of data.messages) {
            const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
            lines.push(`[ ${roleLabel} | ${fmtTs(msg.timestamp)} ]`);
            lines.push('');
            const text = msg.role === 'assistant'
                ? extractAssistantText(msg.content)
                : msg.content;
            lines.push(text);
            lines.push('');
            lines.push('---');
            lines.push('');
        }

        const markdown = lines.join('\n');
        const fileName = `${dateStr}_${sanitizeFileName(data.title)}.md`;

        const message = await downloadMarkdown(fileName, markdown);
        return { ok: true, message };
    } catch {
        return { ok: false, message: sessionExportText('failed') };
    }
}
