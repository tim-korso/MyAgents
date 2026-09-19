// One-time migration for stale agent.runtimeConfig fields (issue #194 follow-up).
//
// Background: between commits a25fc537 (Apr 15) — which added a useEffect that
// reads `runtimeConfig.model` on runtime transitions — and 8020803e (May 2,
// shipped in v0.2.15) — which started correctly writing external-runtime
// model to `runtimeConfig.model` — a latent bug got activated: switching
// runtime (Gemini → Codex) leaked the previous runtime's model into the new
// runtime's session, and Codex CLI rejects mismatched models with
// `"The 'gemini-3.1-pro-preview' model is not supported when using Codex
//   with a ChatGPT account"`.
//
// The write-time fix (`buildRuntimeChangePatch`) prevents new occurrences.
// This migration cleans existing damage in users' config.json so they
// don't have to manually switch runtime twice to self-heal.
//
// Strategy: for each agent where `runtime != 'builtin'` and `runtimeConfig.model`
// (or permissionMode / additionalArgs) exists, check whether the persisted
// values *look* runtime-appropriate via a conservative prefix heuristic. If
// they don't, scrub the offending fields. `envPolicy` is always preserved
// (runtime-agnostic).
//
// One-time guard: agents with `_runtimeConfigScrubV1: true` are skipped. The
// marker is set after a successful scan regardless of whether anything was
// actually changed, so we don't repeat the work every boot.
//
// **Why the heuristic is acceptable here (vs. the render path):** this runs
// exactly once per agent across the app's lifetime. False-positives just mean
// the user re-picks a model they had set; that's a one-time inconvenience.
// False-negatives leave the stale value in place, but the runtime-switch
// helper now scrubs on the next user-initiated switch. The render path
// avoided this heuristic because it would have fired on every Tab open and
// risk invalidating future Codex models with unconventional names — a
// migration doesn't have that property.

import {
  modelLooksLikeRuntime,
  permissionModeLooksLikeRuntime,
  type RuntimeConfig,
  type RuntimeType,
} from '../../shared/types/runtime';
import { atomicModifyConfig, type AgentConfigSlim } from '../utils/admin-config';

// AgentConfigSlim already declares `[key: string]: unknown`, so the marker
// field + runtime / runtimeConfig fields are accessible without a per-call
// cast.
type AgentLike = AgentConfigSlim;

const MARKER_KEY = '_runtimeConfigScrubV1';

interface ScrubResult {
  scannedAgents: number;
  scrubbedAgents: number;
  details: Array<{
    agentId: string;
    runtime: RuntimeType;
    dropped: Partial<RuntimeConfig>;
  }>;
}

/**
 * Run the scrub. Idempotent: agents already marked as scrubbed are skipped.
 *
 * Public for tests; production sidecar calls this from the cleanup phase of
 * deferred-init in `src/server/index.ts`.
 */
export async function scrubStaleRuntimeConfig(): Promise<ScrubResult> {
  const details: ScrubResult['details'] = [];
  let scannedAgents = 0;
  let scrubbedAgents = 0;

  await atomicModifyConfig((cfg) => {
    const agents = (cfg.agents ?? []) as AgentLike[];
    if (agents.length === 0) return cfg;

    let mutated = false;
    const next = agents.map((agent) => {
      // Skip non-external agents and already-scrubbed agents. Marker is set
      // unconditionally below, so the second-pass cost stays O(1) per agent.
      if (agent[MARKER_KEY] === true) return agent;
      scannedAgents += 1;

      const runtime = agent.runtime as RuntimeType | undefined;
      // builtin (or undefined) agents have no runtimeConfig hot fields the
      // way external runtimes do; nothing to scrub. Still mark them so we
      // don't re-scan every boot.
      if (!runtime || runtime === 'builtin') {
        mutated = true;
        return { ...agent, [MARKER_KEY]: true };
      }

      const rc = agent.runtimeConfig as RuntimeConfig | undefined;
      if (!rc) {
        mutated = true;
        return { ...agent, [MARKER_KEY]: true };
      }

      const dropped: Partial<RuntimeConfig> = {};
      const nextRc: RuntimeConfig = { ...rc };

      if (typeof rc.model === 'string' && rc.model.length > 0
          && !modelLooksLikeRuntime(rc.model, runtime)) {
        dropped.model = rc.model;
        delete nextRc.model;
      }
      if (typeof rc.permissionMode === 'string' && rc.permissionMode.length > 0
          && !permissionModeLooksLikeRuntime(rc.permissionMode, runtime)) {
        dropped.permissionMode = rc.permissionMode;
        delete nextRc.permissionMode;
      }
      // additionalArgs is per-runtime by definition (Gemini's --acp flags
      // would be meaningless to Codex, etc). If model OR permissionMode was
      // already obviously cross-runtime, additionalArgs is almost certainly
      // stale too — drop it as well. Otherwise leave it: a user might
      // legitimately keep additionalArgs across CLI choices (unlikely but
      // possible) and we don't want to be aggressive.
      if ((dropped.model !== undefined || dropped.permissionMode !== undefined)
          && Array.isArray(rc.additionalArgs) && rc.additionalArgs.length > 0) {
        dropped.additionalArgs = rc.additionalArgs;
        delete nextRc.additionalArgs;
      }

      if (Object.keys(dropped).length === 0) {
        // Nothing to scrub — still set the marker so we skip next boot.
        mutated = true;
        return { ...agent, [MARKER_KEY]: true };
      }

      mutated = true;
      scrubbedAgents += 1;
      details.push({
        agentId: String(agent.id ?? '<unknown>'),
        runtime,
        dropped,
      });

      // Drop the runtimeConfig key entirely if it's now empty so we don't
      // persist a `runtimeConfig: {}` noise entry. Keep otherwise.
      const hasFields = Object.keys(nextRc).length > 0;
      const out: AgentLike = { ...agent, [MARKER_KEY]: true };
      if (hasFields) {
        out.runtimeConfig = nextRc;
      } else {
        delete out.runtimeConfig;
      }
      return out;
    });

    if (!mutated) return cfg;
    return { ...cfg, agents: next };
  });

  return { scannedAgents, scrubbedAgents, details };
}
