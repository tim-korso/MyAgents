import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "@/../shared/types/task";
import type { TaskComment } from "@/../shared/types/taskComment";
import { taskCommentQuote } from "@/../shared/types/taskComment";
import { CUSTOM_EVENTS } from "@/../shared/constants";
import { TaskCommentTimeline } from "./TaskCommentTimeline";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  context: vi.fn(),
  create: vi.fn(),
  retry: vi.fn(),
  commentChanged: null as null | ((event: { payload?: { taskId?: string } }) => void),
}));

vi.mock("@/api/taskCenter", () => ({
  taskListComments: mocks.list,
  taskGetCommentContext: mocks.context,
  taskCreateUserComment: mocks.create,
  taskRetryComment: mocks.retry,
}));

vi.mock("@/utils/tauriListen", () => ({
  listenWithCleanup: vi.fn(async (
    event: string,
    callback: (event: { payload?: { taskId?: string } }) => void,
  ) => {
    if (event === "task:comment-changed") mocks.commentChanged = callback;
    return {
    unlisten: vi.fn(),
    isRegistered: () => true,
    };
  }),
}));

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    name: "依赖安全检查",
    executor: "agent",
    workspaceId: "workspace-1",
    workspacePath: "/workspace",
    executionMode: "once",
    runMode: "new-session",
    sessionIds: ["session-1"],
    status: "done",
    tags: [],
    createdAt: 1,
    updatedAt: 2,
    statusHistory: [],
    dispatchOrigin: "direct",
    ...overrides,
  };
}

const agentComment: TaskComment = {
  id: "comment-agent",
  taskId: "task-1",
  body: "发现两个高危依赖，需要确认升级范围。",
  author: { kind: "agent", label: "Agent", sessionId: "session-exact" },
  createdAt: Date.parse("2026-08-20T10:00:00+08:00"),
  conversationSessionId: "session-exact",
};

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

function mockReadingViewport(container: HTMLElement, rowTop = 680, rowHeight = 100) {
  const viewport = container.querySelector(".overflow-y-auto") as HTMLElement;
  const scrollTo = vi.fn();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const top = this === viewport ? 80 : rowTop;
    const height = this === viewport ? 500 : rowHeight;
    return { top, bottom: top + height, height, left: 0, right: 800, width: 800, x: 0, y: top, toJSON() {} };
  });
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 500 },
    clientTop: { configurable: true, value: 2 },
    scrollTop: { configurable: true, writable: true, value: 200 },
    scrollTo: { configurable: true, value: scrollTo },
  });
  return scrollTo;
}

describe("TaskCommentTimeline", () => {
  afterEach(() => {
    // Unmount may flush pending effects that still need the browser mocks.
    cleanup();
    vi.restoreAllMocks();
    if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.commentChanged = null;
    Element.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    mocks.list.mockResolvedValue({ items: [], nextBefore: undefined });
    mocks.context.mockResolvedValue({
      items: [agentComment],
      targetCommentId: agentComment.id,
    });
  });

  it("centers notification targets in the reading viewport without scrolling ancestors", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const { container } = render(
      <TaskCommentTimeline task={task()} targetCommentId={agentComment.id} />,
    );
    const scrollTo = mockReadingViewport(container);

    await screen.findByText(agentComment.body);
    // 200 existing scroll + (680 - 80 - 2) relative top + 50 half-row - 250 half-viewport.
    // The row can be present before the notification's passive effect has run.
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 598, behavior: "smooth" }));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("keeps reply-quote navigation in the reading viewport", async () => {
    mocks.list.mockResolvedValueOnce({ items: [agentComment, {
      ...agentComment, id: "reply", body: "收到", replyToCommentId: agentComment.id,
    }] });
    const { container } = render(<TaskCommentTimeline task={task()} />);
    const scrollTo = mockReadingViewport(container);
    fireEvent.click(await screen.findByRole("button", { name: `回复 Agent：${agentComment.body}` }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 598, behavior: "smooth" });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("reveals the previous first comment after prepending inside the reading viewport", async () => {
    mocks.list.mockResolvedValueOnce({ items: [agentComment], nextBefore: agentComment.id });
    mocks.list.mockResolvedValueOnce({ items: [{ ...agentComment, id: "older", body: "更早的评论" }] });
    const { container } = render(<TaskCommentTimeline task={task()} />);
    const scrollTo = mockReadingViewport(container, 780);
    fireEvent.click(await screen.findByRole("button", { name: "加载更早评论" }));
    await screen.findByText("更早的评论");
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 498, behavior: "auto" }));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("supersedes notification smooth scrolling even when the pagination anchor is already visible", async () => {
    mocks.context.mockResolvedValueOnce({ items: [agentComment], previousBefore: agentComment.id });
    mocks.list.mockResolvedValueOnce({ items: [{ ...agentComment, id: "older", body: "更早的评论" }] });
    const { container } = render(<TaskCommentTimeline task={task()} targetCommentId={agentComment.id} />);
    const scrollTo = mockReadingViewport(container, 182);
    await screen.findByText(agentComment.body);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 100, behavior: "smooth" }));

    fireEvent.click(screen.getByRole("button", { name: "加载更早评论" }));
    await screen.findByText("更早的评论");
    // Issuing a scroll to the current position cancels the previous animation;
    // returning without an instruction lets that stale navigation continue.
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith({ top: 200, behavior: "auto" }));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it.each([
    { label: "below", top: 680, height: 100, expectedTop: 398 },
    { label: "above", top: 32, height: 100, expectedTop: 150 },
    { label: "visible", top: 182, height: 100, expectedTop: 200 },
    { label: "tall and spanning", top: 32, height: 700, expectedTop: 200 },
    { label: "tall and below", top: 680, height: 700, expectedTop: 798 },
    { label: "tall and above", top: -718, height: 700, expectedTop: -400 },
  ])("reveals a $label submitted comment with minimal reading scroll", async ({ top, height, expectedTop }) => {
    mocks.create.mockResolvedValue({ ...agentComment, id: "created", body: "新的评论" });
    const { container } = render(<TaskCommentTimeline task={task()} />);
    const scrollTo = mockReadingViewport(container, top, height);
    const textarea = screen.getByPlaceholderText("补充信息或回复 Agent…");
    fireEvent.change(textarea, { target: { value: "新的评论" } });
    fireEvent.click(screen.getByRole("button", { name: "发送评论" }));
    await screen.findByText("新的评论");
    await act(async () => { await new Promise(requestAnimationFrame); });
    expect(scrollTo).toHaveBeenCalledWith({ top: expectedTop, behavior: "smooth" });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("focuses an exact notification target and replies to its frozen Session relation", async () => {
    const created: TaskComment = {
      id: "comment-user",
      taskId: "task-1",
      body: "只升级第一个依赖。",
      author: { kind: "user" },
      createdAt: Date.parse("2026-08-20T10:01:00+08:00"),
      replyToCommentId: agentComment.id,
      conversationSessionId: "session-exact",
      admission: { state: "accepted", targetSessionId: "session-exact" },
    };
    mocks.create.mockResolvedValue(created);
    const onTargetReady = vi.fn();

    render(
      <TaskCommentTimeline
        task={task()}
        targetCommentId={agentComment.id}
        onTargetReady={onTargetReady}
      />,
    );

    const body = await screen.findByText(agentComment.body);
    const row = body.closest('[tabindex="-1"]');
    await waitFor(() => expect(row).toHaveFocus());
    expect(onTargetReady).toHaveBeenCalledWith(true);
    expect(screen.getByText("来自通知的目标评论")).toHaveAttribute(
      "aria-live",
      "polite",
    );

    fireEvent.click(screen.getByRole("button", { name: "回复" }));
    expect(
      screen.getAllByText("发现两个高危依赖，需要确认升级范围。"),
    ).toHaveLength(2);
    fireEvent.change(screen.getByPlaceholderText("补充信息或回复 Agent…"), {
      target: { value: "只升级第一个依赖。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送评论" }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        id: "task-1",
        body: "只升级第一个依赖。",
        replyToCommentId: agentComment.id,
      }),
    );
    expect(await screen.findByText("已进入会话队列")).toBeInTheDocument();
  });

  it("renders compact Markdown and opens an Agent comment Session from its identity line", async () => {
    const markdownComment = {
      ...agentComment,
      body: "**三条重点**\n\n- 第一条\n- 第二条",
    };
    mocks.list.mockResolvedValueOnce({
      items: [markdownComment],
      nextBefore: undefined,
    });
    const onBeforeOpenSession = vi.fn();
    const onOpen = vi.fn();
    window.addEventListener(CUSTOM_EVENTS.OPEN_SESSION_IN_NEW_TAB, onOpen);

    render(
      <TaskCommentTimeline
        task={task()}
        agentLabel="mino"
        onBeforeOpenSession={onBeforeOpenSession}
      />,
    );

    expect(await screen.findByText("三条重点")).toHaveProperty(
      "tagName",
      "STRONG",
    );
    const identity = screen.getByRole("button", {
      name: /Agent\(mino\).*session-/,
    });
    expect(screen.getByText("Agent(mino)")).toHaveClass("text-sm");
    fireEvent.click(identity);

    expect(onBeforeOpenSession).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
    expect((onOpen.mock.calls[0][0] as CustomEvent).detail).toEqual({
      sessionId: "session-exact",
      workspacePath: "/workspace",
      historyEntrySource: "task_run_history",
    });
    expect(identity.closest('[tabindex="-1"]')).not.toHaveClass(
      "hover:bg-[var(--paper-inset)]/70",
    );
    expect(screen.getByPlaceholderText("补充信息或回复 Agent…")).toHaveAttribute(
      "rows",
      "2",
    );

    window.removeEventListener(CUSTOM_EVENTS.OPEN_SESSION_IN_NEW_TAB, onOpen);
  });

  it("keeps the exact Agent(name) identity format when the configured name is Agent", async () => {
    mocks.list.mockResolvedValueOnce({
      items: [agentComment],
      nextBefore: undefined,
    });

    render(<TaskCommentTimeline task={task()} agentLabel="Agent" />);

    expect(
      await screen.findByRole("button", { name: /Agent\(Agent\).*session-/ }),
    ).toBeInTheDocument();
  });

  it("does not restyle marked IME text and remeasures after composition", async () => {
    render(<TaskCommentTimeline task={task()} />);
    const textarea = screen.getByPlaceholderText("补充信息或回复 Agent…");
    let scrollHeight = 40;
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    fireEvent.change(textarea, { target: { value: "初始文本" } });
    expect(textarea.style.height).toBe("40px");

    fireEvent.compositionStart(textarea);
    scrollHeight = 100;
    fireEvent.change(textarea, { target: { value: "输入法组合中的文本" } });
    expect(textarea.style.height).toBe("40px");

    fireEvent.compositionEnd(textarea);
    await waitFor(() => expect(textarea.style.height).toBe("100px"));
  });

  it("remeasures a wrapped draft when the timeline width changes", () => {
    let resizeCallback: ResizeObserverCallback | null = null;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    try {
      render(<TaskCommentTimeline task={task()} />);
      const textarea = screen.getByPlaceholderText("补充信息或回复 Agent…");
      let scrollHeight = 40;
      Object.defineProperty(textarea, "scrollHeight", {
        configurable: true,
        get: () => scrollHeight,
      });
      fireEvent.change(textarea, { target: { value: "会随宽度换行的草稿" } });
      expect(textarea.style.height).toBe("40px");

      scrollHeight = 120;
      act(() => {
        resizeCallback?.(
          [
            {
              contentRect: { width: 500 } as DOMRectReadOnly,
            } as ResizeObserverEntry,
          ],
          {} as ResizeObserver,
        );
      });
      expect(textarea.style.height).toBe("120px");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the composer concise without a routing explanation", async () => {
    render(<TaskCommentTimeline task={task({ sessionIds: [] })} />);

    expect(
      await screen.findByText("暂无评论。可以在这里补充信息或继续跟进任务。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("将发送到最近执行会话")).not.toBeInTheDocument();
    expect(
      screen.queryByText("将保存，并在任务下次产生执行会话后发送"),
    ).not.toBeInTheDocument();
  });

  it("uses the available line for a loaded reply quote with a subtle fill", async () => {
    const longBody = "这是用于验证回复引用展示长度的父评论内容，需要超过六十个字符，并继续补充足够多的文字来确认末尾会正确显示省略号而不是过早截断。";
    const reply: TaskComment = {
      ...agentComment,
      id: "comment-reply-long",
      body: "收到，继续处理。",
      replyToCommentId: agentComment.id,
    };
    mocks.list.mockResolvedValueOnce({
      items: [{ ...agentComment, body: longBody }, reply],
      nextBefore: undefined,
    });

    render(<TaskCommentTimeline task={task()} />);

    const quote = taskCommentQuote(longBody);
    expect(Array.from(quote.slice(0, -1))).toHaveLength(60);
    const quoteButton = await screen.findByRole("button", {
      name: `回复 Agent：${longBody}`,
    });
    expect(quoteButton).toHaveClass(
      "w-full",
      "truncate",
      "rounded-r-md",
      "bg-[var(--hover-bg)]",
    );
    expect(quoteButton).not.toHaveClass("rounded-md");
    expect(quoteButton).toHaveTextContent(longBody);

    fireEvent.click(screen.getAllByRole("button", { name: "回复" })[0]);
    const composerQuote = screen.getAllByText(longBody).at(-1)?.parentElement;
    expect(composerQuote).toHaveClass(
      "rounded-r-lg",
      "bg-[var(--hover-bg)]",
    );
    expect(composerQuote).not.toHaveClass("rounded-lg");
  });

  it("keeps an out-of-window reply parent as a short accessible quote", async () => {
    const reply: TaskComment = {
      ...agentComment,
      id: "comment-reply",
      body: "已经按这条要求补充证据。",
      replyToCommentId: "comment-old-parent",
    };
    mocks.context.mockResolvedValueOnce({
      items: [reply],
      targetCommentId: reply.id,
      replyParents: [
        {
          commentId: "comment-old-parent",
          author: { kind: "user", label: "Ethan" },
          createdAt: 1,
          quote: "请补充独立验证步骤与失败证据",
        },
      ],
    });

    render(<TaskCommentTimeline task={task()} targetCommentId={reply.id} />);

    expect(
      await screen.findByRole("button", {
        name: "回复 Ethan：请补充独立验证步骤与失败证据",
      }),
    ).toBeDisabled();
  });

  it("loads newer comments after a notification-centered page", async () => {
    mocks.context.mockResolvedValueOnce({
      items: [agentComment],
      targetCommentId: agentComment.id,
      nextAfter: agentComment.id,
    });
    mocks.list.mockResolvedValueOnce({
      items: [{ ...agentComment, id: "comment-newer", body: "后续结论" }],
    });

    render(
      <TaskCommentTimeline task={task()} targetCommentId={agentComment.id} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "加载更新评论" }),
    );

    expect(await screen.findByText("后续结论")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledWith("task-1", {
      after: agentComment.id,
      limit: 50,
    });
  });

  it("does not let the old around page overwrite a comment sent after exact navigation", async () => {
    const created: TaskComment = {
      id: "comment-after-route",
      taskId: "task-1",
      body: "补充最新验证结论。",
      author: { kind: "user" },
      createdAt: Date.parse("2026-08-20T10:02:00+08:00"),
      conversationSessionId: "session-exact",
      admission: { state: "accepted", targetSessionId: "session-exact" },
    };
    mocks.list.mockResolvedValue({ items: [created], nextBefore: undefined });
    mocks.create.mockImplementation(async () => {
      mocks.commentChanged?.({ payload: { taskId: "task-1" } });
      await Promise.resolve();
      return created;
    });

    render(
      <TaskCommentTimeline task={task()} targetCommentId={agentComment.id} />,
    );
    await screen.findByText(agentComment.body);
    fireEvent.change(screen.getByPlaceholderText("补充信息或回复 Agent…"), {
      target: { value: created.body },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送评论" }));

    expect(await screen.findByText(created.body)).toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith("task-1", { limit: 50 }));
  });

  it("does not consume a deep link when context loading fails transiently", async () => {
    mocks.context.mockRejectedValueOnce(new Error("temporary read failure"));
    const onTargetReady = vi.fn();

    render(
      <TaskCommentTimeline
        task={task()}
        targetCommentId={agentComment.id}
        onTargetReady={onTargetReady}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "temporary read failure",
    );
    expect(onTargetReady).not.toHaveBeenCalled();
  });
});
