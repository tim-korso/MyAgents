/**
 * Widget library resolution — replace a CDN `<script src>` for a small, trusted
 * set of charting/diagram libraries with the app's locally
 * BUNDLED source, injected INLINE, before the widget runs.
 *
 * Why inline (not a local `src=`): the widget iframe is
 * `sandbox="allow-scripts"` srcdoc → opaque origin, and it INHERITS the
 * top-frame CSP (`script-src 'self' 'unsafe-inline'`). Chromium / WebView2
 * enforces that inherited policy on the iframe, so an external CDN `<script src>`
 * is blocked there (every chart widget would be blank on Windows), and a
 * locally-served `<script src='self'>` is ALSO blocked (the opaque origin's
 * `'self'` matches nothing). Only `'unsafe-inline'` is honoured. So we swap the
 * CDN `<script src>` for an inline `<script>` carrying the bundled source. This
 * also removes the network dependency entirely (offline / slow-CDN-in-China).
 *
 * WebKit (macOS) doesn't enforce inherited srcdoc CSP on external scripts, which
 * is why CDN charts work there today — but inlining is correct on every engine.
 *
 * The bundled source is lazy-loaded as a separate Vite chunk (`?raw`) so it
 * never bloats the initial renderer bundle, and is module-cached after first use.
 * Resolution runs at RENDER time in the renderer (not at generation time in the
 * sidecar) so we never persist ~200KB of inlined library into the session store,
 * and history widgets re-resolve on view.
 *
 * An UNKNOWN library (the open-ended "any package from cdnjs/jsdelivr/…" long
 * tail) is left untouched: its CDN `<script src>` stays, loads where allowed
 * (macOS), and fails visibly via the sandbox's widget:error notice where not.
 */

export interface WidgetLibrary {
  name: string;
  /** Matches the CDN url a model wrote for this library. */
  test: (scriptSrc: string) => boolean;
  /** Lazy `?raw` import of the bundled UMD source. */
  load: () => Promise<string>;
}

const LIBRARIES: WidgetLibrary[] = [
  {
    name: 'chart.js',
    // The contract steers models to cdnjs `…/Chart.js/x/chart.umd.js` or
    // jsdelivr `…/npm/chart.js[@x]`. Anchor on `/`|`@` before `chart` so an
    // unrelated `barchart.js` isn't matched.
    test: (src) => /[/@]chart(?:\.umd|\.min)?\.js|chart\.js@|\/Chart\.js\//i.test(src),
    // `chartjs-umd-source` is a Vite alias to chart.js's UMD dist file (its
    // package `exports` don't expose the UMD); `?raw` yields the source text,
    // lazy-loaded as its own chunk and module-cached.
    load: () => import('chartjs-umd-source?raw').then((m) => m.default),
  },
  {
    name: 'd3',
    test: (src) => /(?:\/d3\/|[/@]d3@|\/d3(?:\.v\d+)?(?:\.min)?\.js(?:[?#]|$))/i.test(src),
    load: () => import('d3-umd-source?raw').then((m) => m.default),
  },
  {
    name: 'lucide',
    test: (src) => /(?:\/lucide\/|[/@]lucide@|\/lucide(?:\.min)?\.js(?:[?#]|$))/i.test(src),
    load: () => import('lucide-umd-source?raw').then((m) => m.default),
  },
];

// Single source of truth for "an external <script src=…></script>" (built fresh
// per call to avoid shared global-regex lastIndex state).
const SCRIPT_SRC_PATTERN = '<script\\b[^>]*\\bsrc\\s*=\\s*["\']([^"\']+)["\'][^>]*>\\s*<\\/script>';

/** Pure: which registered libraries does this widget code reference? (deduped) */
export function detectWidgetLibraries(code: string): WidgetLibrary[] {
  const re = new RegExp(SCRIPT_SRC_PATTERN, 'gi');
  const found = new Map<string, WidgetLibrary>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const src = m[1];
    for (const lib of LIBRARIES) {
      if (!found.has(lib.name) && lib.test(src)) found.set(lib.name, lib);
    }
  }
  return [...found.values()];
}

// Module-level cache: one in-flight/resolved promise per library name.
const sourceCache = new Map<string, Promise<string>>();

/** Load (and cache) the bundled source for each library. */
export function loadLibrarySources(libs: WidgetLibrary[]): Promise<Map<string, string>> {
  return Promise.all(
    libs.map(async (lib) => {
      let p = sourceCache.get(lib.name);
      if (!p) {
        p = lib.load();
        // Don't cache a rejection permanently: a transient lazy-chunk load
        // failure would otherwise blank this library for the rest of the
        // session (no retry). Evict on reject so the next render re-attempts.
        p.catch(() => {
          if (sourceCache.get(lib.name) === p) sourceCache.delete(lib.name);
        });
        sourceCache.set(lib.name, p);
      }
      return [lib.name, await p] as const;
    }),
  ).then((entries) => new Map(entries));
}

/**
 * Pure: replace each external `<script src=KNOWN-CDN-LIB>` with an inline
 * `<script>` carrying the bundled source (so it runs under `'unsafe-inline'`
 * and needs no network). A `</script>` inside the source would prematurely close
 * the inline tag during innerHTML parsing, so it's defensively escaped (a no-op
 * for the minified UMD bundles, which contain none). Unknown libs are untouched.
 */
export function inlineWidgetLibraries(code: string, sources: Map<string, string>): string {
  const re = new RegExp(SCRIPT_SRC_PATTERN, 'gi');
  return code.replace(re, (whole, src: string) => {
    const lib = LIBRARIES.find((l) => l.test(src) && sources.has(l.name));
    if (!lib) return whole;
    // Break any `</script` sequence (not only `</script>`): the HTML tokenizer
    // ends a <script> text node on `</script` followed by `>`, `/`, whitespace
    // or EOF, so escaping the prefix is version-proof. A no-op for the current
    // minified UMD (contains no `</script`), defensive for future bundled libs.
    const safe = sources.get(lib.name)!.replace(/<\/script/gi, '<\\/script');
    return `<script data-inlined-lib="${lib.name}">${safe}</script>`;
  });
}
