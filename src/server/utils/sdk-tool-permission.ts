import type { McpServerProvenance } from '@anthropic-ai/claude-agent-sdk';

/** A configured server with the same wire name must not inherit an SDK server's grant. */
export function toolPermissionGrantKey(toolName: string, server?: McpServerProvenance): string {
  return toolName.startsWith('mcp__')
    ? JSON.stringify([toolName, server?.source ?? null, server?.name ?? null])
    : toolName;
}

/** Only the host can supply source=sdk. Names/prefixes alone are not provenance. */
export function isContextInjectedSdkTool(server: McpServerProvenance | undefined, activeIds: ReadonlySet<string>): boolean {
  return server?.source === 'sdk' && activeIds.has(server.name);
}
