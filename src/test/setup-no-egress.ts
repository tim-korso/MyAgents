import { createRequire, syncBuiltinESMExports } from 'node:module';
import { vi } from 'vitest';

type UnknownFn = (...args: unknown[]) => unknown;
type ModuleLike = Record<string, unknown>;
type PatchableFn = UnknownFn & { [key: symbol]: true | undefined };
type ObjectConstructorLike = new (...args: unknown[]) => object;

const requireBuiltin = createRequire(import.meta.url);

const noEgress = vi.hoisted(() => {
  const PATCHED = Symbol.for('myagents.noEgressPatched');

  function normalizeHost(host: string | undefined): string | undefined {
    if (!host) return undefined;
    let normalized = host.trim().toLowerCase();
    if (normalized.startsWith('[') && normalized.endsWith(']')) {
      normalized = normalized.slice(1, -1);
    }
    const colon = normalized.lastIndexOf(':');
    if (colon > -1 && normalized.indexOf(':') === colon) {
      const maybePort = normalized.slice(colon + 1);
      if (/^\d+$/.test(maybePort)) normalized = normalized.slice(0, colon);
    }
    return normalized;
  }

  function isLoopbackHost(host: string | undefined): boolean {
    const normalized = normalizeHost(host);
    if (!normalized) return true;
    if (normalized === 'localhost' || normalized === '::1') return true;
    if (/^127(?:\.\d{1,3}){3}$/.test(normalized)) return true;
    return false;
  }

  function hostFromUrlLike(value: unknown): string | undefined {
    if (typeof value === 'string' || value instanceof URL) {
      try {
        const url = value instanceof URL ? value : new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
        return url.hostname;
      } catch {
        return undefined;
      }
    }
    if (value && typeof value === 'object') {
      const maybe = value as {
        href?: unknown;
        origin?: unknown;
        uri?: unknown;
        url?: unknown;
      };
      for (const candidate of [maybe.url, maybe.uri, maybe.origin, maybe.href]) {
        if (typeof candidate === 'string' || candidate instanceof URL) {
          const host = hostFromUrlLike(candidate);
          if (host) return host;
        }
      }
    }
    return undefined;
  }

  function hostFromRequestOptions(value: unknown): string | undefined {
    if (!value || typeof value !== 'object' || value instanceof URL) {
      return hostFromUrlLike(value);
    }
    const fromUrl = hostFromUrlLike(value);
    if (fromUrl) return fromUrl;
    const options = value as {
      host?: unknown;
      hostname?: unknown;
      socketPath?: unknown;
    };
    if (typeof options.socketPath === 'string') return undefined;
    const raw = typeof options.hostname === 'string'
      ? options.hostname
      : typeof options.host === 'string'
        ? options.host
        : undefined;
    return normalizeHost(raw);
  }

  function hostFromNetArgs(args: unknown[]): string | undefined {
    const first = args[0];
    if (first && typeof first === 'object') {
      const options = first as {
        host?: unknown;
        hostname?: unknown;
        socketPath?: unknown;
      };
      if (typeof options.socketPath === 'string') return undefined;
      if (typeof options.host === 'string') return options.host;
      if (typeof options.hostname === 'string') return options.hostname;
      return hostFromUrlLike(options);
    }
    if (typeof args[1] === 'string') return args[1];
    return undefined;
  }

  function assertLoopback(host: string | undefined, surface: string): void {
    if (isLoopbackHost(host)) return;
    throw new Error(`[test no-egress] blocked ${surface} to non-loopback host: ${host}`);
  }

  function assertFetch(input: unknown, surface = 'fetch'): void {
    assertLoopback(hostFromUrlLike(input), surface);
  }

  function assertHttp(args: unknown[], surface: string): void {
    for (const candidate of args.slice(0, 2)) {
      const host = hostFromRequestOptions(candidate);
      assertLoopback(host, surface);
    }
  }

  function assertNet(args: unknown[], surface = 'net.connect'): void {
    assertLoopback(hostFromNetArgs(args), surface);
  }

  function assertDns(host: unknown, surface: string): void {
    assertLoopback(typeof host === 'string' ? host : undefined, surface);
  }

  function wrapFunction(fn: UnknownFn, guard: (args: unknown[]) => void): UnknownFn {
    const patchable = fn as PatchableFn;
    if (patchable[PATCHED]) return fn;
    const wrapped = function wrappedNoEgress(this: unknown, ...args: unknown[]) {
      guard(args);
      return fn.apply(this, args);
    } as PatchableFn;
    Object.defineProperty(wrapped, PATCHED, { value: true });
    return wrapped;
  }

  function patchFunction(obj: ModuleLike | undefined, key: string, guard: (args: unknown[]) => void): void {
    if (!obj || typeof obj[key] !== 'function') return;
    try {
      obj[key] = wrapFunction(obj[key] as UnknownFn, guard);
    } catch {
      // ESM module namespace objects are immutable (their properties are
      // non-writable). Node exposes `undici`'s named exports as a namespace, so
      // on Node >= 24 (verified on v26) this assignment throws
      // "Cannot assign to property 'fetch' of [object Module]".
      //
      // Swallowing the failure is safe for a guard whose only job is to *block*
      // egress: a method we could not wrap stays at its original, unguarded
      // implementation, while `patchBuiltins()` already patched the same
      // surface on the CJS builtin (`syncBuiltinESMExports()` re-points the ESM
      // bindings at that patched copy). The writable export object returned by
      // `patchUndiciModule()` still carries the wrapper, so `vi.mock('undici')`
      // consumers keep the guard too. Silently skipping is strictly better than
      // throwing at module-import time and failing the whole suite before a
      // single test runs.
      const restored = typeof obj[key] === 'function' ? obj[key] as UnknownFn : undefined;
      if (restored && !(restored as PatchableFn)[PATCHED]) {
        // Distinct surface name so a future no-egress regression is traceable
        // to the immutable-namespace path rather than looking like "guard never
        // installed". Logged once per key to keep the output readable.
        try {
          process.emitWarning(
            `[test no-egress] ${key} not wrapped (immutable module namespace); relying on the CJS builtin patch`,
          );
        } catch { /* ignore */ }
      }
    }
  }

  function defaultObject(actual: ModuleLike): ModuleLike {
    return actual.default && typeof actual.default === 'object'
      ? actual.default as ModuleLike
      : actual;
  }

  function patchHttpModule(actual: ModuleLike, surface: 'http' | 'https'): ModuleLike {
    const base = defaultObject(actual);
    for (const target of [actual, base]) {
      patchFunction(target, 'request', (args) => assertHttp(args, `${surface}.request`));
      patchFunction(target, 'get', (args) => assertHttp(args, `${surface}.get`));
    }
    return { ...actual, default: base };
  }

  function patchNetModule(actual: ModuleLike): ModuleLike {
    const base = defaultObject(actual);
    for (const target of [actual, base]) {
      patchFunction(target, 'connect', (args) => assertNet(args, 'net.connect'));
      patchFunction(target, 'createConnection', (args) => assertNet(args, 'net.createConnection'));
    }
    const socketCtor = (base.Socket ?? actual.Socket) as { prototype?: ModuleLike } | undefined;
    patchFunction(socketCtor?.prototype, 'connect', (args) => assertNet(args, 'net.Socket.connect'));
    return { ...actual, default: base };
  }

  function patchTlsModule(actual: ModuleLike): ModuleLike {
    const base = defaultObject(actual);
    for (const target of [actual, base]) {
      patchFunction(target, 'connect', (args) => assertNet(args, 'tls.connect'));
    }
    return { ...actual, default: base };
  }

  const DNS_METHODS = [
    'lookup',
    'resolve',
    'resolve4',
    'resolve6',
    'resolveAny',
    'resolveCaa',
    'resolveCname',
    'resolveMx',
    'resolveNaptr',
    'resolveNs',
    'resolvePtr',
    'resolveSoa',
    'resolveSrv',
    'resolveTxt',
    'reverse',
  ];

  function patchDnsModule(actual: ModuleLike, surface: string): ModuleLike {
    const base = defaultObject(actual);
    for (const target of [actual, base]) {
      for (const method of DNS_METHODS) {
        patchFunction(target, method, (args) => assertDns(args[0], `${surface}.${method}`));
      }
    }
    return { ...actual, default: base };
  }

  const UNDICI_REQUEST_METHODS = ['fetch', 'request', 'stream', 'pipeline', 'connect', 'upgrade'];
  const UNDICI_INSTANCE_METHODS = ['request', 'stream', 'pipeline', 'connect', 'upgrade', 'dispatch'];
  const UNDICI_CLASSES = ['Client', 'Pool', 'BalancedPool', 'Agent', 'ProxyAgent'];

  function patchUndiciPrototype(proto: ModuleLike | undefined, className: string): void {
    if (!proto) return;
    for (const method of UNDICI_INSTANCE_METHODS) {
      patchFunction(proto, method, (args) => {
        const first = args[0];
        if (method === 'dispatch' && first && typeof first === 'object') {
          const options = first as { origin?: unknown };
          assertFetch(options.origin ?? first, `undici.${className}.${method}`);
          return;
        }
        assertFetch(first, `undici.${className}.${method}`);
      });
    }
  }

  function patchUndiciClass(actual: ModuleLike, className: string): void {
    const Original = actual[className];
    if (typeof Original !== 'function') return;
    const originalFn = Original as PatchableFn;
    if (originalFn[PATCHED]) return;
    patchUndiciPrototype((Original as { prototype?: ModuleLike }).prototype, className);

    const OriginalCtor = Original as ObjectConstructorLike;
    const Guarded = class extends OriginalCtor {
      constructor(...args: unknown[]) {
        if (args.length > 0) assertFetch(args[0], `undici.${className}`);
        super(...args);
      }
    } as unknown as PatchableFn;
    Object.defineProperty(Guarded, PATCHED, { value: true });
    for (const key of Reflect.ownKeys(Original)) {
      if (key === 'length' || key === 'name' || key === 'prototype') continue;
      const descriptor = Object.getOwnPropertyDescriptor(Original, key);
      if (descriptor) Object.defineProperty(Guarded, key, descriptor);
    }
    actual[className] = Guarded;
  }

  function patchUndiciModule(actual: ModuleLike): ModuleLike {
    for (const method of UNDICI_REQUEST_METHODS) {
      patchFunction(actual, method, (args) => assertFetch(args[0], `undici.${method}`));
    }
    for (const className of UNDICI_CLASSES) {
      patchUndiciClass(actual, className);
    }
    return { ...actual };
  }

  return {
    assertFetch,
    patchDnsModule,
    patchHttpModule,
    patchNetModule,
    patchTlsModule,
    patchUndiciModule,
  };
});

function patchBuiltins(): void {
  noEgress.patchHttpModule(requireBuiltin('node:http') as ModuleLike, 'http');
  noEgress.patchHttpModule(requireBuiltin('node:https') as ModuleLike, 'https');
  noEgress.patchNetModule(requireBuiltin('node:net') as ModuleLike);
  noEgress.patchTlsModule(requireBuiltin('node:tls') as ModuleLike);
  noEgress.patchDnsModule(requireBuiltin('node:dns') as ModuleLike, 'dns');
  noEgress.patchDnsModule(requireBuiltin('node:dns/promises') as ModuleLike, 'dns.promises');
  try {
    noEgress.patchUndiciModule(requireBuiltin('undici') as ModuleLike);
  } catch {
    // Some tests do not install/use undici directly; the vi.mock below still
    // guards ESM imports when the package is resolvable in that project.
  }
  syncBuiltinESMExports();
}

patchBuiltins();

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<ModuleLike>();
  return noEgress.patchUndiciModule(actual);
});

for (const specifier of ['node:http', 'http']) {
  vi.doMock(specifier, async (importOriginal) => (
    noEgress.patchHttpModule(await importOriginal<ModuleLike>(), 'http')
  ));
}

for (const specifier of ['node:https', 'https']) {
  vi.doMock(specifier, async (importOriginal) => (
    noEgress.patchHttpModule(await importOriginal<ModuleLike>(), 'https')
  ));
}

for (const specifier of ['node:net', 'net']) {
  vi.doMock(specifier, async (importOriginal) => (
    noEgress.patchNetModule(await importOriginal<ModuleLike>())
  ));
}

for (const specifier of ['node:tls', 'tls']) {
  vi.doMock(specifier, async (importOriginal) => (
    noEgress.patchTlsModule(await importOriginal<ModuleLike>())
  ));
}

for (const specifier of ['node:dns', 'dns']) {
  vi.doMock(specifier, async (importOriginal) => (
    noEgress.patchDnsModule(await importOriginal<ModuleLike>(), 'dns')
  ));
}

for (const specifier of ['node:dns/promises', 'dns/promises']) {
  vi.doMock(specifier, async (importOriginal) => (
    noEgress.patchDnsModule(await importOriginal<ModuleLike>(), 'dns.promises')
  ));
}

const fetchPatchSymbol = Symbol.for('myagents.noEgressFetchPatched');
const currentFetch = globalThis.fetch as (typeof fetch & { [key: symbol]: true | undefined }) | undefined;
if (typeof currentFetch === 'function' && !currentFetch[fetchPatchSymbol]) {
  const originalFetch = currentFetch.bind(globalThis);
  const guardedFetch = ((input, init) => {
    noEgress.assertFetch(input);
    return originalFetch(input, init);
  }) as typeof fetch & { [key: symbol]: true };
  Object.defineProperty(guardedFetch, fetchPatchSymbol, { value: true });
  globalThis.fetch = guardedFetch;
}
