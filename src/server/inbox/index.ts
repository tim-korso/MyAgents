// Session Inbox module entry (PRD 0.2.18)
//
// Public exports for use from `src/server/index.ts`, `agent-session.ts`,
// `external-session.ts`, and tests.

export { sanitizeInboxLabel } from './sanitize-label';
export { deriveSessionLabel } from './derive-label';
export { handleAdminInbox } from './admin-handler';
export type { AdminInboxRequest, AdminInboxResponse } from './admin-handler';
export { handleInboxDrain } from './drain-handler';
export type { InboxInjector } from './drain-handler';
export { deliverInboxReply } from './reply-deliver';
export type { ReplyPayload } from './reply-deliver';
export type {
  InboxMessageKind,
  PendingInboxMessage,
  InboxTurnMeta,
  DrainResponse,
  DeliverOutcome,
} from './types';
export { buildInReplyToSnippet, IN_REPLY_TO_SNIPPET_LENGTH } from './types';
