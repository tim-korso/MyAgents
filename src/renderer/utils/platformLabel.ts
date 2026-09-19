// Display label for an IM channel platform / type.
//
// Channel `type` comes in three shapes:
//   • Built-in platforms ("telegram" / "feishu" / "dingtalk") → hard-coded
//     localized labels.
//   • OpenClaw plugin channels ("openclaw:<platform>", e.g. "openclaw:larksuite",
//     "openclaw:wechat") → resolve via the promoted-plugin registry to the
//     plugin's display name (fallbacks to the bare platform slug).
//   • Anything else → the raw type string unchanged.
//
// Used by places that show a user-friendly channel badge (AgentCardList,
// NotificationConfigEditor, etc.) so the mapping stays in one file and
// adding a new built-in platform or promoted plugin is a single-point edit.

import { findPromotedByPlatform } from '@/components/ImSettings/promotedPlugins';

const BUILTIN_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  feishu: '飞书',
  dingtalk: '钉钉',
};

export function getPlatformLabel(type: string): string {
  if (type.startsWith('openclaw:')) {
    const promoted = findPromotedByPlatform(type);
    return promoted?.name || type.slice('openclaw:'.length);
  }
  return BUILTIN_LABELS[type] || type;
}
