export type OpenClawConfigSnapshot = {
  channels: Record<string, Record<string, unknown>>;
} & Record<string, unknown>;

const CONFIG_GLOBAL_KEY = '__MYAGENTS_OPENCLAW_CONFIG__';

type ConfigGlobal = typeof globalThis & {
  [CONFIG_GLOBAL_KEY]?: OpenClawConfigSnapshot;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function packageBasename(entryModule: string): string {
  const channelKey = entryModule.replace(/^@[^/]+\//, '');
  return channelKey;
}

function legacyInferredChannelKey(entryModule: string): string {
  let channelKey = packageBasename(entryModule);
  if (/lark|feishu/i.test(entryModule)) {
    channelKey = 'feishu';
  } else if (/qqbot|qq/i.test(entryModule)) {
    channelKey = 'qqbot';
  } else if (/dingtalk/i.test(entryModule)) {
    channelKey = 'dingtalk';
  } else if (/telegram/i.test(entryModule)) {
    channelKey = 'telegram';
  }
  return channelKey;
}

function manifestChannelKey(manifest: unknown): string | undefined {
  const root = asRecord(manifest);
  const channels = Array.isArray(root.channels) ? root.channels : [];
  for (const channel of channels) {
    const key = nonEmptyString(channel);
    if (key) return key;
  }

  const channelId = nonEmptyString(asRecord(root.channel).id);
  if (channelId) return channelId;

  const packageOpenClawChannelId = nonEmptyString(asRecord(asRecord(root.openclaw).channel).id);
  if (packageOpenClawChannelId) return packageOpenClawChannelId;

  const channelConfigs = asRecord(root.channelConfigs);
  const channelConfigKeys = Object.keys(channelConfigs).filter(key => key.trim());
  return channelConfigKeys.length === 1 ? channelConfigKeys[0] : undefined;
}

export function inferOpenClawChannelKey(args: {
  entryModule: string;
  manifest?: unknown;
}): string {
  return manifestChannelKey(args.manifest) ?? legacyInferredChannelKey(args.entryModule);
}

function manifestPluginId(manifest: unknown): string | undefined {
  return nonEmptyString(asRecord(manifest).id);
}

function collectChannelAliases(args: {
  entryModule: string;
  manifest?: unknown;
  channelKey: string;
}): string[] {
  const aliases = new Set<string>();
  const add = (value: string | undefined) => {
    if (value && value !== args.channelKey) aliases.add(value);
  };

  // Old MyAgents data often uses the installation/package identity while
  // OpenClaw plugins read their protocol channel identity.
  add(packageBasename(args.entryModule));
  add(legacyInferredChannelKey(args.entryModule));
  add(manifestPluginId(args.manifest));

  return [...aliases];
}

export function normalizeOpenClawConfig(value: unknown): OpenClawConfigSnapshot {
  const root = asRecord(value);
  const rawChannels = asRecord(root.channels);
  const channels: Record<string, Record<string, unknown>> = {};
  for (const [key, channelValue] of Object.entries(rawChannels)) {
    channels[key] = asRecord(channelValue);
  }
  return { ...root, channels };
}

export function buildOpenClawConfig(args: {
  entryModule: string;
  pluginConfig: Record<string, unknown>;
  manifest?: unknown;
}): { channelKey: string; config: OpenClawConfigSnapshot } {
  const channelKey = inferOpenClawChannelKey({
    entryModule: args.entryModule,
    manifest: args.manifest,
  });
  const channelConfig = {
    enabled: true,
    ...args.pluginConfig,
    dmPolicy: 'open',
    groupPolicy: 'open',
  };
  const baseConfig: OpenClawConfigSnapshot = {
    channels: {
      [channelKey]: channelConfig,
    },
  };
  return {
    channelKey,
    config: addOpenClawChannelAliases(
      baseConfig,
      collectChannelAliases({
        entryModule: args.entryModule,
        manifest: args.manifest,
        channelKey,
      }),
      channelKey,
    ),
  };
}

export function addOpenClawChannelAlias(
  config: OpenClawConfigSnapshot,
  alias: string | undefined,
  sourceKey: string,
): OpenClawConfigSnapshot {
  if (!alias || alias === sourceKey) return config;
  const source = config.channels[sourceKey];
  if (!source) return config;
  return {
    ...config,
    channels: {
      ...config.channels,
      [alias]: source,
    },
  };
}

export function addOpenClawChannelAliases(
  config: OpenClawConfigSnapshot,
  aliases: Iterable<string | undefined>,
  sourceKey: string,
): OpenClawConfigSnapshot {
  let next = config;
  for (const alias of aliases) {
    next = addOpenClawChannelAlias(next, alias, sourceKey);
  }
  return next;
}

export function setOpenClawConfigSnapshot(config: unknown): OpenClawConfigSnapshot {
  const normalized = normalizeOpenClawConfig(config);
  (globalThis as ConfigGlobal)[CONFIG_GLOBAL_KEY] = normalized;
  return normalized;
}

export function getOpenClawConfigSnapshot(): OpenClawConfigSnapshot {
  const snapshot = (globalThis as ConfigGlobal)[CONFIG_GLOBAL_KEY];
  return cloneConfig(snapshot ?? { channels: {} });
}
