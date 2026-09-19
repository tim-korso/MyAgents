// Image content block translation

import { writeFileSync , existsSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { ensureGitignorePattern } from '../../utils/gitignore';
import type { AnthropicImageBlock } from '../types/anthropic';
import type { OpenAIContentPart } from '../types/openai';
import { ensureDirSync } from '../../utils/fs-utils';

/** Anthropic image block → OpenAI image_url content part */
export function translateImageBlock(block: AnthropicImageBlock): OpenAIContentPart {
  if (block.source.type === 'url' && block.source.url) {
    return {
      type: 'image_url',
      image_url: { url: block.source.url },
    };
  }
  // base64 → data URI
  const mediaType = block.source.media_type || 'image/png';
  const data = block.source.data || '';
  return {
    type: 'image_url',
    image_url: { url: `data:${mediaType};base64,${data}` },
  };
}

/**
 * Callback type for saving tool result images to disk.
 * Returns the relative path (e.g., "myagents_files/temp/tool_xxx.png").
 */
export type ToolImageSaver = (base64: string, mimeType: string) => string;

/**
 * Create a ToolImageSaver that writes images to {workspace}/myagents_files/temp/.
 * Tool result images are temporary — the AI references them by relative path.
 */
export function createToolImageSaver(workspacePath: string): ToolImageSaver {
  const dir = join(workspacePath, 'myagents_files', 'temp');
  let dirEnsured = false;

  return (base64: string, mimeType: string): string => {
    // Lazy dir creation + stale cleanup (once per session)
    if (!dirEnsured) {
      if (!existsSync(dir)) {
        ensureDirSync(dir);
      }
      ensureGitignorePattern(workspacePath, 'myagents_files/');
      // Clean up stale temp images older than 1 hour
      try {
        const cutoff = Date.now() - 60 * 60 * 1000;
        for (const file of readdirSync(dir)) {
          try {
            const fp = join(dir, file);
            if (statSync(fp).mtimeMs < cutoff) unlinkSync(fp);
          } catch { /* ignore individual file errors */ }
        }
      } catch { /* ignore cleanup errors */ }
      dirEnsured = true;
    }

    const buf = Buffer.from(base64, 'base64');
    if (buf.length === 0) throw new Error('Empty image data');
    const subtype = mimeType.split('/')[1]?.split('+')[0] || 'png';
    const ext = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(subtype) ? (subtype === 'jpeg' ? 'jpg' : subtype) : 'png';
    const filename = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const filepath = join(dir, filename);
    writeFileSync(filepath, buf);

    // Return relative path from workspace root (for AI reference)
    return `myagents_files/temp/${filename}`;
  };
}
