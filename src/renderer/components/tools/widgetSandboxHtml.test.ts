// Characterization test for the widget sandbox's failure handling.
//
// Bug context: DeepSeek V4 Pro (and other weaker / non-Claude models) routinely
// emit a widget whose inline JS is malformed — e.g. a Chart config missing one
// closing brace. The parse/runtime error is thrown INSIDE the sandboxed iframe,
// invisible to the parent console and the app's unified log, so the user just
// sees a blank box with no clue why (real incident: session 936489e3, the
// 国运曲线 line chart). The sandbox must therefore (1) catch such failures so one
// bad script doesn't abort the rest of the widget, (2) show a visible inline
// notice instead of a silent blank, and (3) forward the error to the parent so
// it lands in the main console / logs. These assertions lock that contract in.
import { describe, expect, it } from 'vitest';

import { buildSandboxHtml } from './widgetSandboxHtml';

const html = buildSandboxHtml(':root{--widget-text:#222}');

describe('widget sandbox failure handling', () => {
  it('captures script errors via a global error listener', () => {
    expect(html).toContain("addEventListener('error'");
  });

  it('forwards the failure to the parent as widget:error', () => {
    expect(html).toContain("type: 'widget:error'");
  });

  it('renders a visible inline notice (not a silent blank)', () => {
    expect(html).toContain('data-widget-error');
    expect(html).toContain("This component's script could not run");
  });

  it('accepts a localized inline notice prefix', () => {
    const localized = buildSandboxHtml(':root{}', {
      scriptErrorPrefix: 'This component failed: ',
    });

    expect(localized).toContain('This component failed: ');
    expect(localized).not.toContain("This component's script could not run");
  });

  it('can update the inline notice prefix without rebuilding the iframe srcdoc', () => {
    expect(html).toContain('widgetScriptErrorPrefix');
    expect(html).toContain("e.data.type === 'widget:i18n'");
  });

  it('wraps inline-script execution in try/catch so one bad script does not abort the chain', () => {
    // The inline-script branch of runScripts must guard replaceChild — WebKit
    // throws a malformed inline script's SyntaxError synchronously there.
    expect(html).toMatch(/try\s*{[\s\S]*replaceChild[\s\S]*catch/);
  });
});

describe('widget sandbox CSP allowlist', () => {
  // A widget that <link>s a Google Fonts stylesheet (the AI reaches for these for
  // decorative Chinese fonts — Noto Serif SC / ZCOOL XiaoWei / Ma Shan Zheng) needs
  // TWO hops allowed: the CSS host in style-src AND the woff2 host in font-src. Miss
  // either and the font is blocked (CSP console error) and silently falls back to the
  // system stack — the 万历 widget incident. On WebKit this meta CSP is authoritative;
  // the parent CSP in tauri.conf.json must stay in sync for Chromium/WebView2.
  it('allows the Google Fonts stylesheet host in style-src', () => {
    expect(html).toMatch(/style-src[^;]*https:\/\/fonts\.googleapis\.com/);
  });

  it('allows the Google Fonts woff2 host in font-src', () => {
    expect(html).toMatch(/font-src[^;]*https:\/\/fonts\.gstatic\.com/);
  });

  it('keeps connect-src locked down (no fetch/XHR/WS exfil from widgets)', () => {
    // default-src 'none' with no connect-src override = network requests blocked.
    // Allowing fonts must NOT have loosened this.
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain('connect-src');
  });
});
