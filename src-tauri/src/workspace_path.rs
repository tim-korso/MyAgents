/// Stable lexical workspace identity shared by Rust domains.
///
/// This intentionally does not canonicalize because historical tasks and
/// sessions may reference workspaces that are not currently mounted.
pub(crate) fn normalize_workspace_path_identity(path: &str) -> String {
    let windows_style = (path.len() >= 2 && path.as_bytes()[1] == b':')
        || path.starts_with("\\\\")
        || path.starts_with("//");
    let mut normalized = if windows_style {
        path.replace('\\', "/")
    } else {
        path.to_string()
    };
    if normalized.is_empty() {
        return normalized;
    }

    let bytes = normalized.as_bytes();
    let min_len = if bytes.len() >= 3 && bytes[1] == b':' && bytes[2] == b'/' {
        3
    } else if normalized.starts_with("//") {
        2
    } else if normalized.starts_with('/') {
        1
    } else {
        0
    };
    while normalized.len() > min_len && normalized.ends_with('/') {
        normalized.pop();
    }

    if (normalized.len() >= 2 && normalized.as_bytes()[1] == b':') || normalized.starts_with("//") {
        normalized.make_ascii_lowercase();
    }
    normalized
}
