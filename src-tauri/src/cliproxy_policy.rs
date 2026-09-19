//! Required context: specs/tech_docs/managed_cliproxy.md (resource release policy).
//! Shared by build.rs and runtime; a normal App version bump never edits policy.
use std::collections::BTreeSet;

pub fn version(value: &str) -> Result<[u64; 3], &'static str> {
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3 { return Err("Expected a numeric x.y.z version"); }
    let mut result = [0; 3];
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty() || (part.len() > 1 && part.starts_with('0'))
            || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err("Invalid version component");
        }
        result[index] = part.parse().map_err(|_| "Version component overflow")?;
    }
    Ok(result)
}

pub fn select_release_index(app: &str, minimums: &[&str]) -> Result<Option<usize>, &'static str> {
    let app = version(app)?;
    let mut seen = BTreeSet::new();
    let mut best = None;
    for (index, minimum) in minimums.iter().enumerate() {
        let minimum = version(minimum)?;
        if !seen.insert(minimum) { return Err("Duplicate minimum App version"); }
        if minimum <= app && best.is_none_or(|(_, previous)| minimum > previous) {
            best = Some((index, minimum));
        }
    }
    Ok(best.map(|(index, _)| index))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn release_thresholds_are_order_independent_and_open_ended() {
        let floors = ["0.4.20", "0.4.17"];
        for app in ["0.4.17", "0.4.18", "0.4.19"] {
            assert_eq!(select_release_index(app, &floors), Ok(Some(1)));
        }
        for app in ["0.4.20", "0.4.100", "1.0.0"] {
            assert_eq!(select_release_index(app, &floors), Ok(Some(0)));
        }
        assert_eq!(select_release_index("0.4.16", &floors), Ok(None));
        assert_eq!(select_release_index("0.4.9", &["0.4.10"]), Ok(None));
        assert!(select_release_index("0.4.20", &["0.4.17", "0.4.17"]).is_err());
        assert!(select_release_index("0.4.20", &["0.4.17-beta"]).is_err());
    }
}
