import {
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";

import { ToastProvider } from "@/components/Toast";
import { DEFAULT_CONFIG, PROXY_DEFAULTS, type AppConfig, type Provider } from "@/config/types";
import Settings from "./SettingsPage";

const settingsMocks = vi.hoisted(() => ({
  linux: true,
  config: {} as AppConfig,
  atomicModifyConfig: vi.fn(),
  patchProxySettings: vi.fn(),
  refreshConfig: vi.fn(),
  apiPostJson: vi.fn(),
  invoke: vi.fn(),
}));

const visionProvider = {
  id: "vision-provider",
  name: "Vision Provider",
  vendor: "Test",
  cloudProvider: "模型官方",
  type: "api",
  primaryModel: "vision-model",
  isBuiltin: false,
  config: { baseUrl: "https://example.invalid" },
  models: [
    {
      model: "vision-model",
      modelName: "Vision Model",
      modelSeries: "test",
      inputModalities: ["text", "image"],
    },
  ],
} as Provider;
const stableProviders = [visionProvider];
const stableProjects: never[] = [];
const stableApiKeys = { "vision-provider": "configured-key" };
const stableVerifyStatus = {};
const configNoop = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: settingsMocks.invoke }));
vi.mock("@/components/MonacoEditor", () => ({ default: () => null }));
vi.mock("@/components/SettingsHelperInbox", () => ({ default: () => null }));
vi.mock("@/components/UnifiedLogsPanel", () => ({
  UnifiedLogsPanel: () => null,
}));
vi.mock("@/components/WorkspaceConfigPanel", () => ({ default: () => null }));
vi.mock("@/components/GlobalPluginsPanel", () => ({ default: () => null }));
vi.mock("@/components/dev/CronTaskDebugPanel", () => ({ default: () => null }));
vi.mock("@/components/ImSettings", () => ({ BotPlatformRegistry: () => null }));

vi.mock("@/hooks/useConfig", () => ({
  useConfig: () => ({
    apiKeys: stableApiKeys,
    saveApiKey: configNoop,
    deleteApiKey: configNoop,
    providerVerifyStatus: stableVerifyStatus,
    saveProviderVerifyStatus: configNoop,
    config: settingsMocks.config,
    updateConfig: configNoop,
    patchProxySettings: settingsMocks.patchProxySettings,
    providers: stableProviders,
    projects: stableProjects,
    addProject: configNoop,
    updateProject: configNoop,
    addCustomProvider: configNoop,
    updateCustomProvider: configNoop,
    deleteCustomProvider: configNoop,
    refreshProviders: configNoop,
    savePresetCustomModels: configNoop,
    removePresetCustomModel: configNoop,
    savePrimaryModel: configNoop,
    saveProviderModelAliases: configNoop,
    refreshConfig: settingsMocks.refreshConfig,
    managedCodexRuntimeUpdateInFlight: false,
    requestManagedCodexRuntimeUpdate: configNoop,
  }),
}));

vi.mock("@/config/configService", async () => {
  const actual = await vi.importActual<typeof import("@/config/configService")>(
    "@/config/configService",
  );
  return {
    ...actual,
    atomicModifyConfig: settingsMocks.atomicModifyConfig,
    getAllMcpServers: vi.fn().mockResolvedValue([]),
    getEnabledMcpServerIds: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/api/apiFetch", () => ({
  apiFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
  apiGetJson: vi.fn().mockResolvedValue({ success: true, data: {} }),
  apiPostJson: settingsMocks.apiPostJson,
}));

vi.mock("@/hooks/useSpaceBuildCapability", () => ({
  useSpaceBuildCapability: () => ({
    activeEnvironment: "production",
    environments: ["production"],
  }),
}));

vi.mock("@/hooks/useAutostart", () => ({
  useAutostart: () => ({
    isEnabled: false,
    isLoading: false,
    setAutostart: vi.fn(),
  }),
}));

vi.mock("@/hooks/useHelperAgentModelDefaults", () => ({
  useHelperAgentModelDefaults: () => ({}),
}));

vi.mock("@/theme", async () => {
  const actual = await vi.importActual<typeof import("@/theme")>("@/theme");
  return { ...actual, useResolvedTheme: () => ({ id: "warm-paper" }) };
});

vi.mock("@/api/recording", () => ({
  speechModelPackInstall: vi.fn(),
  speechModelPackRemove: vi.fn(),
  speechModelPackStatus: vi.fn().mockResolvedValue(null),
}));


vi.mock('@/utils/desktopPlatform', () => ({
  isLinuxDesktop: () => settingsMocks.linux,
  getPlatformHiddenProviderIds: () => settingsMocks.linux ? ['codex-sub', 'antigravity-sub'] : [],
}));
vi.mock('@/utils/tauriListen', () => ({ listenWithCleanup: vi.fn(async () => {}) }));

describe('Ubuntu settings availability', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    settingsMocks.config = { ...DEFAULT_CONFIG, agents: [], showDevTools: true,
      floatingBallDevGate: true, managedCodexProviderDevGate: true,
      proxySettings: { ...PROXY_DEFAULTS, enabled: true, scope: { mode: 'custom', generalRequests: false,
        providerIds: ['codex-sub', 'vision-provider', 'antigravity-sub'] } } };
    settingsMocks.invoke.mockResolvedValue(undefined);
    settingsMocks.apiPostJson.mockResolvedValue({ success: true, data: { models: [] } });
    await i18n.changeLanguage('en-US');
  });

  it('redirects a saved desktop-pet route and removes unsupported/update controls without changing config', async () => {
    settingsMocks.linux = true;
    const onCheckForUpdate = vi.fn();
    render(<ToastProvider><Settings mode="settings" initialSection="desktop-pet" isActive
      onCheckForUpdate={onCheckForUpdate} /></ToastProvider>);
    await waitFor(() => expect(screen.getByText(String(i18n.t('about.manualLinuxUpdate', { ns: 'settings' })))).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: String(i18n.t('about.checkUpdates', { ns: 'settings' })) })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: String(i18n.t('sidebar.nav.floatingBall', { ns: 'settings' })) })).not.toBeInTheDocument();
    expect(screen.queryByText(String(i18n.t('about.desktopPetTitle', { ns: 'settings' })))).not.toBeInTheDocument();
    expect(screen.queryByText(String(i18n.t('about.developer.codexProviderTitle', { ns: 'settings' })))).not.toBeInTheDocument();
    expect(onCheckForUpdate).not.toHaveBeenCalled();
    expect(settingsMocks.config.floatingBallDevGate).toBe(true);
    expect(settingsMocks.config.managedCodexProviderDevGate).toBe(true);
    expect(settingsMocks.patchProxySettings).not.toHaveBeenCalled();
    expect(settingsMocks.invoke.mock.calls.filter(([command]) => String(command).startsWith('cmd_managed_codex'))).toHaveLength(0);
  });

  it('keeps the normal update and desktop-pet controls on supported platforms', async () => {
    settingsMocks.linux = false;
    render(<ToastProvider><Settings mode="settings" initialSection="about" isActive /></ToastProvider>);
    await waitFor(() => expect(screen.getByRole('button', { name: String(i18n.t('about.checkUpdates', { ns: 'settings' })) })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: String(i18n.t('sidebar.nav.floatingBall', { ns: 'settings' })) })).toBeInTheDocument();
    expect(screen.queryByText(String(i18n.t('about.manualLinuxUpdate', { ns: 'settings' })))).not.toBeInTheDocument();
  });
});
