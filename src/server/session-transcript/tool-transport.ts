import { maybeSpill } from "../utils/large-value-store";

export interface ToolPresentationEvent {
  event: string;
  data: Record<string, unknown>;
}
export interface ToolPresentation {
  immediate: ToolPresentationEvent[];
  deferred?: Promise<ToolPresentationEvent[]>;
}

/** Canonical content has already been recorded. This only adapts large tool
 * bodies to the existing preview/ref protocol; callers never await it in the
 * native event consumer and must retain their original writer authority. */
export function prepareToolPresentationEvent(
  event: string,
  data: Record<string, unknown>,
  sessionId: string,
): ToolPresentation {
  if (
    /^chat:(?:subagent-)?tool-(?:input|result)-delta$/.test(event) &&
    typeof data.delta === "string" &&
    data.delta.length > 8192
  ) {
    return {
      immediate: [
        {
          event,
          data: {
            ...data,
            delta: `${data.delta.slice(0, 7168)}\n…\n${data.delta.slice(-1024)}`,
          },
        },
      ],
    };
  }
  const resultEvent =
    /^chat:(?:subagent-)?tool-result-(?:start|complete)$/.test(event);
  if (
    resultEvent &&
    typeof data.content === "string" &&
    Buffer.byteLength(data.content) > 192 * 1024
  ) {
    const content = data.content;
    return {
      immediate: [
        { event, data: { ...data, content: content.slice(0, 8192) } },
      ],
      deferred: maybeSpill(content, {
        inlineMaxBytes: 192 * 1024,
        previewBytes: 8192,
        mimetype: "text/plain; charset=utf-8",
        sessionId,
      })
        .then((spilled) => [
          {
            event,
            data:
              "inline" in spilled
                ? data
                : {
                    ...data,
                    content: spilled.preview,
                    metadata: {
                      ...((data.metadata as object) ?? {}),
                      largeValueRef: spilled,
                    },
                  },
          },
        ])
        .catch((error) => {
          console.warn(
            "[transcript] Tool result preview storage unavailable:",
            error,
          );
          return [];
        }),
    };
  }
  const nested = event === "chat:subagent-tool-use";
  const start =
    event === "chat:tool-use-start" || event === "chat:server-tool-use-start";
  const stop = event === "chat:content-block-stop";
  if (!nested && !start && !stop) return { immediate: [{ event, data }] };
  const tool = nested ? (data.tool as Record<string, unknown>) : data;
  if (!tool?.input || typeof tool.input !== "object")
    return { immediate: [{ event, data }] };
  const serialized = JSON.stringify(tool.input);
  if (Buffer.byteLength(serialized) <= 192 * 1024)
    return { immediate: [{ event, data }] };
  const preview = nested
    ? { ...data, tool: { ...tool, input: {} } }
    : { ...data, input: {} };
  return {
    immediate: [{ event, data: preview }],
    deferred: maybeSpill(serialized, {
      inlineMaxBytes: 192 * 1024,
      previewBytes: 0,
      mimetype: "application/json; charset=utf-8",
      sessionId,
    })
      .then((spilled) => {
        if ("inline" in spilled) return [{ event, data }];
        if (nested)
          return [
            {
              event,
              data: { ...preview, inputRef: spilled, finalInput: true },
            },
          ];
        if (stop)
          return [
            { event, data: { ...data, input: undefined, inputRef: spilled } },
          ];
        return [
          {
            event: "chat:content-block-stop",
            data: { toolId: tool.id, type: "tool_use", inputRef: spilled },
          },
        ];
      })
      .catch((error) => {
        console.warn(
          "[transcript] Tool input preview storage unavailable:",
          error,
        );
        return [];
      }),
  };
}
