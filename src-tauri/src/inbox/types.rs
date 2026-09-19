// Session Inbox 数据结构 (PRD 0.2.18)
//
// 对称于 `crate::im::types::PendingCronEvent`,但抽象更通用:
//   - cron 是单向(cron task → IM bot session)
//   - inbox 是双向(任意 session A ↔ 任意 session B)
//   - cron 队列挂在 `ImBotInstance` 上(IM Bot 专属)
//   - inbox 队列挂在 `SessionSidecar` 上(任何 sidecar 通用)
//
// 与 cron 不同的语义:**fire-and-forget**——投递失败由 caller AI 自决重试,
// 不做 at-least-once / 重启 replay / correlationId 幂等。详见 PRD §1.3。

use serde::{Deserialize, Serialize};

/// Inbox 消息类型——request(初始投递)或 reply(target turn-end 推回)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum InboxMessageKind {
    /// Caller 主动投递的 prompt(等同于"用户 message")
    #[default]
    Request,
    /// Target turn-end 之后,系统反向推回 caller 的 reply
    Reply,
    /// System-delivered session event (watch completion/status, etc.).
    Event,
}

/// 待投递的 inbox message——挂在 target sidecar 的 `pending_inbox_messages` 队列
/// 上,Rust 端 push,sidecar drain handler 取出后用
/// `<myagents-session-event>` 注入 enqueueUserMessage / sendExternalMessage。
///
/// 字段沿用 cron 的 camelCase serde 风格,跨 Rust↔TS 边界保持一致。
/// 所有可选/新字段带 `#[serde(default)]`,后续加字段不影响旧版本反序列化。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingInboxMessage {
    /// 唯一 ID,UUID。Reply 时通过 `in_reply_to` 关联回原 request 的 `message_id`,
    /// 帮 caller AI 在同时发出多条时把 reply 关联到对应的 request。
    pub message_id: String,

    /// Caller session ID(谁发的)。如果 caller 是 cron task,这里是 cron task session;
    /// 如果是桌面/IM Bot,这里是对应 session。
    pub from_session_id: String,

    /// Caller 的人类可读 label,由 caller sidecar 的 `deriveSessionLabel()` 推导。
    /// 经过 `sanitizeInboxLabel()` HTML escape + 80 字符截断后注入到 target 的 prompt。
    /// `#[serde(default)]`:旧版本/缺字段时回退为空字符串(sidecar 端再 fallback 到 "a session")。
    #[serde(default)]
    pub from_label: String,

    /// Target session ID(投给谁)
    pub to_session_id: String,

    /// Prompt 文本内容。CLI `-p/--prompt` 或 `--prompt-file` 读出的内容,直接落地。
    /// 注意:此字段命名 `text` 与 PRD §5.2 Admin API body 字段 `prompt` 不同——前者是
    /// Rust transport-level 通用命名(对齐 `PendingCronEvent.content` 风格),后者是
    /// CLI 用户面命名(对齐 `cron add --prompt`)。两个层次解耦。
    pub text: String,

    /// 是否期待 target turn-end 后反向推 reply 回 caller。
    /// `true`(send 模式) / `false`(notify 模式,对应 CLI `--no-reply`)。
    /// Reply 消息(kind=Reply)时此字段恒为 false(避免无限往返)。
    pub reply_back: bool,

    /// Unix-millis 时间戳,push 入队时填入。仅用于日志和 dedup 调试,不参与业务逻辑。
    #[serde(default)]
    pub timestamp_ms: i64,

    /// Request 还是 Reply。`#[serde(default)]` → 旧 payload 默认 Request。
    #[serde(default)]
    pub kind: InboxMessageKind,

    /// Reply 时携带,关联回原 request 的 `message_id`。
    /// 帮 caller AI 在同时发出多条 send 时关联回是哪一条的回应。
    #[serde(default)]
    pub in_reply_to: Option<String>,

    /// Structured MyAgents Session Event Protocol v1 payload. Node sidecar
    /// renders this into `<myagents-session-event>` before injecting it into
    /// the target runtime. Optional for backwards compatibility with older
    /// request/reply payloads.
    #[serde(default)]
    pub session_event: Option<serde_json::Value>,
}

impl PendingInboxMessage {
    /// 构造一个 Request 类型的 inbox message
    pub fn new_request(
        from_session_id: String,
        from_label: String,
        to_session_id: String,
        text: String,
        reply_back: bool,
    ) -> Self {
        Self {
            message_id: uuid::Uuid::new_v4().to_string(),
            from_session_id,
            from_label,
            to_session_id,
            text,
            reply_back,
            timestamp_ms: chrono::Utc::now().timestamp_millis(),
            kind: InboxMessageKind::Request,
            in_reply_to: None,
            session_event: None,
        }
    }

    /// 构造一个 Reply 类型的 inbox message(由 target sidecar 在 turn-end 时调用)
    pub fn new_reply(
        from_session_id: String,
        from_label: String,
        to_session_id: String,
        text: String,
        in_reply_to: String,
    ) -> Self {
        Self {
            message_id: uuid::Uuid::new_v4().to_string(),
            from_session_id,
            from_label,
            to_session_id,
            text,
            // Reply 的 reply_back 恒为 false——避免 reply 的 reply 的 reply ……
            // 形成无限往返;多轮对话由 caller AI 显式发起新 send 驱动。
            reply_back: false,
            timestamp_ms: chrono::Utc::now().timestamp_millis(),
            kind: InboxMessageKind::Reply,
            in_reply_to: Some(in_reply_to),
            session_event: None,
        }
    }
}
