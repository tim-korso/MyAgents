/** Per-request constraints supplied by the runtime; never session preferences. */
export interface ToolPermissionHints {
    defaultToNo?: boolean;
    suppressAlwaysAllowRule?: boolean;
}
