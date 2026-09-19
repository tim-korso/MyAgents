import { describe, expect, it } from 'vitest';

import {
  buildOpenClawConfig,
  inferOpenClawChannelKey,
  normalizeOpenClawConfig,
} from './openclaw-config';

describe('plugin bridge OpenClaw config', () => {
  it('uses manifest channel identity for WeCom and keeps package identity as alias', () => {
    const result = buildOpenClawConfig({
      entryModule: '@wecom/wecom-openclaw-plugin',
      manifest: {
        id: 'wecom-openclaw-plugin',
        channels: ['wecom'],
      },
      pluginConfig: {
        botId: 'bot-1',
        secret: 'secret-1',
      },
    });

    expect(result.channelKey).toBe('wecom');
    expect(result.config.channels.wecom).toMatchObject({
      enabled: true,
      botId: 'bot-1',
      secret: 'secret-1',
      dmPolicy: 'open',
      groupPolicy: 'open',
    });
    expect(result.config.channels['wecom-openclaw-plugin']).toBe(result.config.channels.wecom);
  });

  it('uses Feishu channel identity for Lark plugin and aliases plugin identity', () => {
    const result = buildOpenClawConfig({
      entryModule: '@larksuite/openclaw-lark',
      manifest: {
        id: 'openclaw-lark',
        channels: ['feishu'],
      },
      pluginConfig: {
        appId: 'cli_a',
        appSecret: 'sec',
      },
    });

    expect(result.channelKey).toBe('feishu');
    expect(result.config.channels.feishu).toMatchObject({
      enabled: true,
      appId: 'cli_a',
      appSecret: 'sec',
    });
    expect(result.config.channels['openclaw-lark']).toBe(result.config.channels.feishu);
  });

  it('falls back to the single channelConfigs key when channels is absent', () => {
    const inferred = inferOpenClawChannelKey({
      entryModule: 'openclaw-plugin-yuanbao',
      manifest: {
        id: 'openclaw-plugin-yuanbao',
        channelConfigs: {
          yuanbao: { schema: { type: 'object' } },
        },
      },
    });

    const result = buildOpenClawConfig({
      entryModule: 'openclaw-plugin-yuanbao',
      manifest: {
        id: 'openclaw-plugin-yuanbao',
        channelConfigs: {
          yuanbao: { schema: { type: 'object' } },
        },
      },
      pluginConfig: {
        appKey: 'key-1',
      },
    });

    expect(inferred).toBe('yuanbao');
    expect(result.channelKey).toBe('yuanbao');
    expect(result.config.channels['openclaw-plugin-yuanbao']).toBe(result.config.channels.yuanbao);
  });

  it('keeps existing QQ and Weixin manifest channel identities stable', () => {
    const qq = buildOpenClawConfig({
      entryModule: '@sliverp/qqbot',
      manifest: {
        id: 'qqbot',
        channels: ['qqbot'],
      },
      pluginConfig: {
        appId: 'qq-app',
      },
    });

    const weixin = buildOpenClawConfig({
      entryModule: '@tencent-weixin/openclaw-weixin',
      manifest: {
        id: 'openclaw-weixin',
        channels: ['openclaw-weixin'],
      },
      pluginConfig: {
        accountId: 'wx-1',
      },
    });

    expect(qq.channelKey).toBe('qqbot');
    expect(qq.config.channels.qqbot).toMatchObject({ appId: 'qq-app' });
    expect(weixin.channelKey).toBe('openclaw-weixin');
    expect(weixin.config.channels['openclaw-weixin']).toMatchObject({ accountId: 'wx-1' });
  });

  it('uses package openclaw.channel.id metadata when standalone manifest channels are absent', () => {
    expect(inferOpenClawChannelKey({
      entryModule: '@wecom/wecom-openclaw-plugin',
      manifest: {
        channel: {
          id: 'wecom',
        },
      },
    })).toBe('wecom');

    expect(inferOpenClawChannelKey({
      entryModule: '@wecom/wecom-openclaw-plugin',
      manifest: {
        openclaw: {
          channel: {
            id: 'wecom',
          },
        },
      },
    })).toBe('wecom');
  });

  it('keeps legacy package inference for plugins without manifest channel metadata', () => {
    expect(inferOpenClawChannelKey({
      entryModule: '@larksuite/openclaw-lark',
    })).toBe('feishu');
    expect(inferOpenClawChannelKey({
      entryModule: '@wecom/wecom-openclaw-plugin',
    })).toBe('wecom-openclaw-plugin');
  });

  it('normalizes malformed channel values while preserving channel map shape', () => {
    expect(normalizeOpenClawConfig({
      channels: {
        feishu: null,
        wecom: { botId: 'bot-1' },
      },
    })).toEqual({
      channels: {
        feishu: {},
        wecom: { botId: 'bot-1' },
      },
    });
  });
});
