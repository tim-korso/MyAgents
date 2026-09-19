// Session Inbox module (PRD 0.2.18)
//
// 实现 session 间异步消息通道——AI 通过 `myagents session send` CLI 命令
// 把 prompt 投递给另一个 session,target 处理后回应自动推回 caller。
//
// 关键设计(详见 specs/prd/prd_0.2.18_session_inbox.md):
//
//   - Fire-and-forget(无持久化、无 at-least-once 重试、无 correlationId 幂等)
//   - 跨 sidecar 路由:复用 cron→IM 的 `pending_events` 模式但去掉 Rust 端队列
//     ——cron 用队列因为 heartbeat 异步驱动;inbox 走同步 HTTP POST 到
//     `/api/inbox/drain`,没有消费者就 push 队列只会泄漏(cross-review Arch:
//     早期设计带 SessionSidecar.pending_inbox_messages 队列,实现阶段去掉了)
//   - 投递路径:CLI → admin API → `cmd_inbox_deliver` → 必要时
//     ensure_session_sidecar 唤起 target → HTTP POST 到 target sidecar
//     `/api/inbox/drain` → sidecar 包裹 <myagents-session-event> 注入 enqueueUserMessage
//   - Reply 路径:target turn-end → builtin SDK result / external persistTurnResult
//     → 同一 `cmd_inbox_deliver`(kind=Reply, reply_back=false)→ caller sidecar
//     `/api/inbox/drain` → 包裹 send.result session event 注入

pub mod deliver;
pub mod types;
pub mod watch;

pub use deliver::cmd_inbox_deliver;
pub use types::{InboxMessageKind, PendingInboxMessage};
