import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "@/utils/browserMock";

const DEVICE_ID_KEY = "myagents_device_id";

let cachedDeviceId: string | null = null;
let cachedAppVersion: string | null = null;
let cachedPlatform: string | null = null;
let cachedOsVersion: string | null = null;
let cachedDeviceName: string | null = null;

export interface DeviceIdentity {
  deviceId: string;
  deviceName?: string | null;
  platform: string;
  osVersion?: string | null;
  appVersion: string;
}

export async function preloadDeviceId(): Promise<void> {
  if (!cachedDeviceId) {
    cachedDeviceId = await loadDeviceIdAsync();
  }
}

export function getDeviceId(): string {
  if (!cachedDeviceId) {
    cachedDeviceId = getDeviceIdFromLocalStorage();
  }
  return cachedDeviceId;
}

export async function preloadPlatform(): Promise<void> {
  if (!cachedPlatform) {
    cachedPlatform = await detectPlatformAsync();
  }
}

export function getPlatform(): string {
  if (!cachedPlatform) {
    cachedPlatform = detectPlatformFallback();
  }
  return cachedPlatform;
}

export async function getAppVersion(): Promise<string> {
  if (cachedAppVersion) {
    return cachedAppVersion;
  }

  try {
    cachedAppVersion = isTauriEnvironment() ? await getVersion() : "dev";
  } catch {
    cachedAppVersion = "unknown";
  }
  return cachedAppVersion;
}

export function getAppVersionSync(): string {
  return cachedAppVersion || "unknown";
}

export async function preloadAppVersion(): Promise<void> {
  await getAppVersion();
}

export async function preloadDeviceIdentity(): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      const identity = await invoke<DeviceIdentity>("cmd_get_device_identity");
      cachedDeviceId = identity.deviceId;
      cachedDeviceName = identity.deviceName ?? null;
      cachedPlatform = identity.platform;
      cachedOsVersion = identity.osVersion ?? null;
      cachedAppVersion = identity.appVersion;
      return;
    } catch (error) {
      console.warn(
        "[DeviceIdentity] Failed to load full device identity from Rust:",
        error,
      );
    }
  }
  await Promise.all([
    preloadDeviceId(),
    preloadAppVersion(),
    preloadPlatform(),
    preloadOsVersion(),
  ]);
}

export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  await preloadDeviceIdentity();
  return {
    deviceId: getDeviceId(),
    deviceName: cachedDeviceName,
    platform: getPlatform(),
    osVersion: getOsVersionSync(),
    appVersion: getAppVersionSync(),
  };
}

async function loadDeviceIdAsync(): Promise<string> {
  try {
    if (isTauriEnvironment()) {
      return await invoke<string>("cmd_get_device_id");
    }
    return getDeviceIdFromLocalStorage();
  } catch (error) {
    console.warn("[DeviceIdentity] Failed to load device_id from Rust:", error);
    return getDeviceIdFromLocalStorage();
  }
}

function getDeviceIdFromLocalStorage(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

async function detectPlatformAsync(): Promise<string> {
  try {
    if (isTauriEnvironment()) {
      return await invoke<string>("cmd_get_platform");
    }
    return detectPlatformFallback();
  } catch {
    return detectPlatformFallback();
  }
}

function detectPlatformFallback(): string {
  try {
    const navPlatform = navigator.platform.toLowerCase();
    if (navPlatform.includes("mac") || navPlatform.includes("darwin"))
      return "darwin-x86_64";
    if (navPlatform.includes("win")) return "windows-x86_64";
    if (navPlatform.includes("linux")) return "linux-x86_64";
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function preloadOsVersion(): Promise<void> {
  if (cachedOsVersion !== null) return;
  cachedOsVersion = detectOsVersionFallback();
}

function getOsVersionSync(): string | null {
  if (cachedOsVersion === null) {
    cachedOsVersion = detectOsVersionFallback();
  }
  return cachedOsVersion;
}

function detectOsVersionFallback(): string | null {
  try {
    const userAgent = navigator.userAgent.trim();
    if (!userAgent) return null;
    const mac = userAgent.match(/Mac OS X ([0-9_]+)/);
    if (mac?.[1]) return `macOS ${mac[1].replace(/_/g, ".")}`;
    const windows = userAgent.match(/Windows NT ([0-9.]+)/);
    if (windows?.[1]) return `Windows NT ${windows[1]}`;
    const android = userAgent.match(/Android ([0-9.]+)/);
    if (android?.[1]) return `Android ${android[1]}`;
    return null;
  } catch {
    return null;
  }
}
