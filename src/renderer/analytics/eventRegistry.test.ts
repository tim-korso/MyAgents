import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();

function readFiles(root: string): Array<{ path: string; text: string }> {
  const result: Array<{ path: string; text: string }> = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist' || entry === 'server-dist') continue;
        visit(fullPath);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      if (/\.(test|unit\.test)\.(ts|tsx)$/.test(entry)) continue;
      result.push({ path: fullPath, text: readFileSync(fullPath, 'utf-8') });
    }
  };
  visit(root);
  return result;
}

function declaredEventNames(): Set<string> {
  const typesPath = resolve(REPO_ROOT, 'src/renderer/analytics/types.ts');
  const text = readFileSync(typesPath, 'utf-8');
  const union = text.match(/export type EventName =([\s\S]*?);/);
  if (!union) throw new Error('EventName union not found');
  return new Set([...union[1].matchAll(/\|\s*'([^']+)'/g)].map(match => match[1]));
}

function trackedLiteralEvents(): Map<string, Set<string>> {
  const files = [
    ...readFiles(resolve(REPO_ROOT, 'src/renderer')),
    ...readFiles(resolve(REPO_ROOT, 'src/server')),
  ];
  const events = new Map<string, Set<string>>();
  const trackedCallNames = new Set(['track', 'trackTabEvent', 'trackServer']);

  for (const file of files) {
    const source = ts.createSourceFile(
      file.path,
      file.text,
      ts.ScriptTarget.Latest,
      true,
      file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        trackedCallNames.has(node.expression.text)
      ) {
        const firstArg = node.arguments[0];
        if (firstArg && ts.isStringLiteralLike(firstArg)) {
          const paths = events.get(firstArg.text) ?? new Set<string>();
          paths.add(relative(REPO_ROOT, file.path));
          events.set(firstArg.text, paths);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return events;
}

describe('analytics event registry', () => {
  it('declares every tracked literal event in EventName', () => {
    const declared = declaredEventNames();
    const tracked = trackedLiteralEvents();

    const missing = [...tracked.entries()]
      .filter(([event]) => !declared.has(event))
      .map(([event, paths]) => `${event} (${[...paths].join(', ')})`);

    expect(missing).toEqual([]);
  });

  it('keeps declared events tied to call sites unless explicitly allowlisted', () => {
    const declared = declaredEventNames();
    const tracked = trackedLiteralEvents();
    const intentionallyDeclaredWithoutCallSite = new Set([
      // Legacy IM Bot event names kept for historical warehouse compatibility.
      // Current channel management flows use agent_channel_* events instead.
      'im_bot_create',
      'im_bot_toggle',
      'im_bot_remove',
    ]);

    const missingCallSites = [...declared]
      .filter(event => !tracked.has(event))
      .filter(event => !intentionallyDeclaredWithoutCallSite.has(event))
      .sort();

    expect(missingCallSites).toEqual([]);
  });

  it('documents every tracked literal event in analytics_design.md', () => {
    const doc = readFileSync(resolve(REPO_ROOT, 'specs/tech_docs/analytics_design.md'), 'utf-8');
    const tracked = trackedLiteralEvents();
    const missing = [...tracked.keys()]
      .filter(event => !doc.includes(`\`${event}\``))
      .sort();

    expect(missing).toEqual([]);
  });
});
