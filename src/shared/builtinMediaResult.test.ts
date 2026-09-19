import { describe, it, expect } from 'vitest';
import {
  parseBuiltinMediaToolResult,
  parseEdgeTtsResult,
  parseGeminiImageResult,
  audioMimeFromPath,
  imageMimeFromPath,
  unwrapMcpResult,
  EDGE_TTS_TOOL,
  GEMINI_GENERATE_TOOL,
  GEMINI_EDIT_TOOL,
} from './builtinMediaResult';

const EDGE_TTS_RESULT = [
  '语音已生成。',
  '',
  'filePath: /Users/me/.myagents/generated_audio/tts_abc12345.mp3',
  'voice: zh-CN-XiaoxiaoNeural',
  'duration: 23.1s',
  'format: mp3',
  'size: 135.4KB',
  'rate: 0%',
  'volume: 0%',
  'pitch: +0Hz',
  'textPreview: 夏天赖着不走 蝉把整个下午锯成...',
].join('\n');

const GEMINI_RESULT = [
  '图片已生成。',
  '',
  'contextId: imgctx_abcd',
  'filePath: /Users/me/.myagents/generated/imgctx_abcd_0.png',
  'resolution: 1K | aspectRatio: auto',
  'model: gemini-2.5-flash-image',
  '',
  '图片描述: a serene mountain lake at dawn',
  '',
  '如需修改此图片，请使用 edit_image 工具并传入 contextId: imgctx_abcd',
].join('\n');

describe('parseEdgeTtsResult', () => {
  it('parses all card-meta fields', () => {
    const r = parseEdgeTtsResult(EDGE_TTS_RESULT);
    expect(r).toMatchObject({
      filePath: '/Users/me/.myagents/generated_audio/tts_abc12345.mp3',
      voice: 'zh-CN-XiaoxiaoNeural',
      duration: '23.1s',
      format: 'mp3',
      size: '135.4KB',
      isVoiceList: false,
    });
    expect(r.textPreview).toContain('夏天赖着不走');
  });

  it('flags list_voices results', () => {
    expect(parseEdgeTtsResult('Found 42 voice(s):\n...').isVoiceList).toBe(true);
  });

  it('captures error results', () => {
    const r = parseEdgeTtsResult('Error: Text cannot be empty.');
    expect(r.error).toBe('Error: Text cannot be empty.');
    expect(r.filePath).toBeUndefined();
  });

  it('returns empty shape for undefined', () => {
    expect(parseEdgeTtsResult(undefined)).toEqual({ isVoiceList: false });
  });
});

describe('parseGeminiImageResult', () => {
  it('parses generate result incl. description / resolution split', () => {
    const r = parseGeminiImageResult(GEMINI_RESULT);
    expect(r).toMatchObject({
      contextId: 'imgctx_abcd',
      filePath: '/Users/me/.myagents/generated/imgctx_abcd_0.png',
      resolution: '1K',
      aspectRatio: 'auto',
      model: 'gemini-2.5-flash-image',
      description: 'a serene mountain lake at dawn',
      isEdit: false,
    });
  });

  it('detects edit count + isEdit', () => {
    const edit = GEMINI_RESULT.replace('图片已生成。', '图片已编辑（第 3 次修改）。');
    const r = parseGeminiImageResult(edit);
    expect(r.isEdit).toBe(true);
    expect(r.editCount).toBe(3);
  });
});

describe('parseBuiltinMediaToolResult', () => {
  it('derives an audio spec from edge-tts', () => {
    const specs = parseBuiltinMediaToolResult(EDGE_TTS_TOOL, EDGE_TTS_RESULT);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      filePath: '/Users/me/.myagents/generated_audio/tts_abc12345.mp3',
      mimeType: 'audio/mpeg',
      kind: 'audio',
      producedBy: 'mcp.edge-tts.text_to_speech',
    });
    expect(specs[0].caption).toContain('zh-CN-XiaoxiaoNeural');
    expect(specs[0].caption).toContain('夏天赖着不走');
  });

  it('derives an image spec with description as caption', () => {
    const specs = parseBuiltinMediaToolResult(GEMINI_GENERATE_TOOL, GEMINI_RESULT);
    expect(specs[0]).toMatchObject({
      mimeType: 'image/png',
      kind: 'image',
      caption: 'a serene mountain lake at dawn',
      producedBy: 'mcp.gemini-image.generate_image',
    });
  });

  it('tags edit_image with the edit producedBy', () => {
    const edit = GEMINI_RESULT.replace('图片已生成。', '图片已编辑（第 2 次修改）。');
    expect(parseBuiltinMediaToolResult(GEMINI_EDIT_TOOL, edit)[0].producedBy).toBe('mcp.gemini-image.edit_image');
  });

  it('infers jpg mime from extension', () => {
    const r = GEMINI_RESULT.replace('imgctx_abcd_0.png', 'imgctx_abcd_0.jpg');
    expect(parseBuiltinMediaToolResult(GEMINI_GENERATE_TOOL, r)[0].mimeType).toBe('image/jpeg');
  });

  it('unwraps the MCP content-array JSON form', () => {
    const wrapped = JSON.stringify([{ type: 'text', text: EDGE_TTS_RESULT }], null, 2);
    const specs = parseBuiltinMediaToolResult(EDGE_TTS_TOOL, wrapped);
    expect(specs).toHaveLength(1);
    expect(specs[0].kind).toBe('audio');
    expect(specs[0].filePath).toMatch(/tts_abc12345\.mp3$/);
  });

  it('returns [] for non-media tools', () => {
    expect(parseBuiltinMediaToolResult('Bash', 'filePath: /x.mp3')).toEqual([]);
    expect(parseBuiltinMediaToolResult('mcp__cron-tools__create', GEMINI_RESULT)).toEqual([]);
  });

  it('returns [] for error / list-voices / missing filePath', () => {
    expect(parseBuiltinMediaToolResult(EDGE_TTS_TOOL, 'Error: Text cannot be empty.')).toEqual([]);
    expect(parseBuiltinMediaToolResult(EDGE_TTS_TOOL, 'Found 3 voice(s):\n...')).toEqual([]);
    expect(parseBuiltinMediaToolResult(GEMINI_GENERATE_TOOL, 'Error generating image: quota')).toEqual([]);
    expect(parseBuiltinMediaToolResult(EDGE_TTS_TOOL, 'voice: x\nformat: mp3')).toEqual([]);
    expect(parseBuiltinMediaToolResult(EDGE_TTS_TOOL, '')).toEqual([]);
  });

  it('handles windows absolute paths (drive colon in value)', () => {
    const win = EDGE_TTS_RESULT.replace(
      '/Users/me/.myagents/generated_audio/tts_abc12345.mp3',
      'C:\\Users\\me\\.myagents\\generated_audio\\tts_abc12345.mp3',
    );
    expect(parseBuiltinMediaToolResult(EDGE_TTS_TOOL, win)[0].filePath).toBe(
      'C:\\Users\\me\\.myagents\\generated_audio\\tts_abc12345.mp3',
    );
  });
});

describe('mime + unwrap helpers', () => {
  it('audioMimeFromPath', () => {
    expect(audioMimeFromPath('a.mp3')).toBe('audio/mpeg');
    expect(audioMimeFromPath('a.wav')).toBe('audio/wav');
    expect(audioMimeFromPath('a.unknown')).toBe('audio/mpeg');
  });
  it('imageMimeFromPath', () => {
    expect(imageMimeFromPath('a.png')).toBe('image/png');
    expect(imageMimeFromPath('a.jpeg')).toBe('image/jpeg');
    expect(imageMimeFromPath('a.xyz')).toBe('image/png');
  });
  it('unwrapMcpResult passes through plain text', () => {
    expect(unwrapMcpResult('语音已生成。')).toBe('语音已生成。');
  });
  it('unwrapMcpResult unwraps a content array', () => {
    expect(unwrapMcpResult('[{"type":"text","text":"hi"}]')).toBe('hi');
  });
  it('unwrapMcpResult tolerates leading whitespace before the array (no parser drift)', () => {
    // The pre-refactor server parser used trimStart().startsWith('['); a leading
    // newline must NOT skip unwrapping.
    expect(unwrapMcpResult('\n  [{"type":"text","text":"hi"}]')).toBe('hi');
  });
});
