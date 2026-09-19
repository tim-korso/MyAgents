use std::collections::HashMap;
use std::sync::{Arc, Weak};

type LifecycleMutex = tokio::sync::Mutex<()>;

/// Small reusable registry for serializing lifecycle mutations by identity.
/// Weak entries keep the registry self-pruning once no operation owns or waits
/// on a key.
pub(crate) struct KeyedLifecycleRegistry {
    locks: tokio::sync::Mutex<HashMap<String, Weak<LifecycleMutex>>>,
}

impl KeyedLifecycleRegistry {
    pub(crate) fn new() -> Self {
        Self {
            locks: tokio::sync::Mutex::new(HashMap::new()),
        }
    }

    async fn locks_for(&self, keys: &[&str]) -> Vec<Arc<LifecycleMutex>> {
        let mut identities = keys
            .iter()
            .map(|key| key.trim())
            .filter(|key| !key.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        identities.sort();
        identities.dedup();

        let mut registry = self.locks.lock().await;
        registry.retain(|_, lock| lock.strong_count() > 0);
        identities
            .into_iter()
            .map(|identity| {
                if let Some(lock) = registry.get(&identity).and_then(Weak::upgrade) {
                    return lock;
                }
                let lock = Arc::new(LifecycleMutex::new(()));
                registry.insert(identity, Arc::downgrade(&lock));
                lock
            })
            .collect()
    }

    pub(crate) async fn acquire(&self, keys: &[&str]) -> KeyedLifecycleGuard {
        let locks = self.locks_for(keys).await;
        let mut guards = Vec::with_capacity(locks.len());
        for lock in locks {
            guards.push(lock.lock_owned().await);
        }
        KeyedLifecycleGuard { _guards: guards }
    }

    pub(crate) async fn try_acquire(&self, key: &str) -> Option<KeyedLifecycleGuard> {
        let lock = self.locks_for(&[key]).await.into_iter().next()?;
        let guard = lock.try_lock_owned().ok()?;
        Some(KeyedLifecycleGuard {
            _guards: vec![guard],
        })
    }
}

pub(crate) struct KeyedLifecycleGuard {
    _guards: Vec<tokio::sync::OwnedMutexGuard<()>>,
}
