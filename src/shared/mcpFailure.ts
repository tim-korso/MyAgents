/** Only these bounded categories may cross the Runtime → UI/log boundary. */
export type McpFailureCode =
  | 'MCP_STARTUP_FAILED'
  | 'MCP_CONNECTION_TIMEOUT'
  | 'MCP_RUNTIME_MISSING'
  | 'MCP_PACKAGE_FAILED'
  | 'MCP_CONFIG_INVALID'
  | 'MCP_CONNECTION_FAILED'
  | 'MCP_NEEDS_AUTH'
  | 'MCP_RUNTIME_EXITED';

/** Classify locally; never return the original message (it may contain credentials). */
export function classifyMcpFailure(error: unknown, failureReason?: unknown): McpFailureCode {
  const message = [error instanceof Error ? error.message : error, failureReason]
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.slice(0, 8_192))
    .join(' ');
  if (/timed?\s*out|timeout|deadline.*exceeded/i.test(message)) return 'MCP_CONNECTION_TIMEOUT';
  if (/unknown option|unrecognized (?:option|argument)|invalid (?:argument|config)|invalid_configuration/i.test(message)) return 'MCP_CONFIG_INVALID';
  if (/cannot find (?:module|package)|module_not_found|err_module_not_found|npm (?:err|error)|eintegrity/i.test(message)) return 'MCP_PACKAGE_FAILED';
  if (/spawn.*enoent|command not found|executable.*not found|no such file or directory/i.test(message)) return 'MCP_RUNTIME_MISSING';
  if (/needs.auth|unauthori[sz]ed|authentication|invalid.*(?:token|credential)|\b401\b/i.test(message)) return 'MCP_NEEDS_AUTH';
  if (/econnrefused|econnreset|connection (?:closed|refused|reset)|failed to connect|browser_transport_failed|browser_host_stopping|browser_connection_/i.test(message)) return 'MCP_CONNECTION_FAILED';
  return 'MCP_STARTUP_FAILED';
}

export interface McpRetryResult {
  /** Accepted for reconnection, not a claim that the new connection is ready. */
  success: boolean;
  status?: number;
  errorCode?: 'session_busy' | 'unsupported_runtime' | 'server_not_failed' | 'retry_failed';
}
