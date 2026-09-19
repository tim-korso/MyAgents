const SENSITIVE_KEY_RE = /secret|token|password|key/i;

function maskSecret(value: string): string {
  if (!value) return '***';
  return `${value.slice(0, 4)}***`;
}

function redactValue(
  value: unknown,
  key: string | undefined,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === 'string') {
    return key && SENSITIVE_KEY_RE.test(key) ? maskSecret(value) : value;
  }
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key, seen));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
      childKey,
      redactValue(childValue, childKey, seen),
    ]),
  );
}

export function redactPluginBridgeSecrets(value: unknown): unknown {
  return redactValue(value, undefined, new WeakSet());
}
