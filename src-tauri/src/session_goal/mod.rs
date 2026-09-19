//! Session-owned Goal state and lifecycle.
//!
//! A Goal is an extension of one MyAgents Session. It is not a scheduled
//! Task, a CronTask projection, or a Task Center record. The module owns the
//! durable concurrency protocol used by desktop, IM, and Agent Channel turns.

pub mod commands;
mod execution;
mod init;
mod manager;
mod scheduler;
mod store;
mod types;

pub use init::initialize_session_goal_manager;
pub use manager::{get_session_goal_manager, SessionGoalManager};
pub use types::{
    GoalContinuationRequest, GoalDeliveryOutboxItem, GoalEndConditions, GoalMutationError,
    GoalMutationErrorCode, GoalStatus, GoalTerminalActor, GoalTerminalOutcome, GoalTurnAuthority,
    GoalTurnFinalization, GoalTurnFinalizationRequest, GoalTurnKind, SessionGoal,
    SessionGoalConfig, SessionGoalView,
};
