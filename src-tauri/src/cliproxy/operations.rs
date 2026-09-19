//! Query operation settlement is retained for the exact Sidecar lifetime.
//! A timed-out acquire can arrive after release; it must never reopen a lease.
use super::types::{Error, Result};
use std::collections::HashMap;

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Phase {
    Preparing,
    Acquired,
    Released,
}
struct Operation {
    sidecar: String,
    generation: u64,
    identity: String,
    phase: Phase,
}
#[derive(Default)]
pub(super) struct Operations(HashMap<String, Operation>);
impl Operations {
    pub fn begin(
        &mut self,
        key: &str,
        sidecar: &str,
        generation: u64,
        identity: &str,
    ) -> Result<bool> {
        if let Some(operation) = self.0.get(key) {
            if operation.phase == Phase::Released {
                return Err(Error::cancelled());
            }
            if operation.identity != identity {
                return Err(Error::contract());
            }
            return Ok(false);
        }
        self.0.insert(
            key.to_owned(),
            Operation {
                sidecar: sidecar.to_owned(),
                generation,
                identity: identity.to_owned(),
                phase: Phase::Preparing,
            },
        );
        Ok(true)
    }
    pub fn phase(&self, key: &str) -> Option<Phase> {
        self.0.get(key).map(|o| o.phase)
    }
    pub fn acquire(&mut self, key: &str) -> Result<()> {
        let op = self
            .0
            .get_mut(key)
            .filter(|o| o.phase == Phase::Preparing)
            .ok_or_else(Error::cancelled)?;
        op.phase = Phase::Acquired;
        Ok(())
    }
    pub fn release(&mut self, key: &str, sidecar: &str, generation: u64) {
        self.0
            .entry(key.to_owned())
            .and_modify(|o| o.phase = Phase::Released)
            .or_insert(Operation {
                sidecar: sidecar.to_owned(),
                generation,
                identity: String::new(),
                phase: Phase::Released,
            });
    }
    pub fn reconcile(&mut self, live: impl Fn(&str, u64) -> bool) {
        self.0.retain(|_, op| live(&op.sidecar, op.generation));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lost_acquire_and_late_duplicate_cannot_reopen_released_operation() {
        let mut ops = Operations::default();
        ops.release("late", "sidecar", 3);
        assert!(ops.begin("late", "sidecar", 3, "model").is_err());
        assert!(ops.begin("started", "sidecar", 3, "model").unwrap());
        assert!(!ops.begin("started", "sidecar", 3, "model").unwrap());
        ops.release("started", "sidecar", 3);
        assert!(ops.acquire("started").is_err());
        ops.reconcile(|_, generation| generation == 4);
        assert!(ops.phase("late").is_none());
        assert!(ops.begin("new", "sidecar", 4, "model").unwrap());
    }
    #[test]
    fn same_operation_cannot_change_model_or_purpose() {
        let mut ops = Operations::default();
        assert!(ops.begin("key", "sidecar", 1, "execution:a").unwrap());
        assert!(ops.begin("key", "sidecar", 1, "verification:b").is_err());
        ops.acquire("key").unwrap();
        ops.release("key", "sidecar", 1);
        assert!(ops.begin("key", "sidecar", 1, "execution:a").is_err());
    }
}
