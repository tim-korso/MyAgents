// Required context: specs/tech_docs/managed_cliproxy.md (bundled baseline versus online policy).
//! Build inputs have a stricter source pin than runtime updates. Reuse the
//! resource signature trust root; verify the exact bundled target and bytes.
use sha2::{Digest, Sha256};
use std::{env, fs, path::Path};

pub fn verify_bundle(app_version: &str) {
    let platform = match (
        env::var("CARGO_CFG_TARGET_OS").as_deref(),
        env::var("CARGO_CFG_TARGET_ARCH").as_deref(),
    ) {
        (Ok("macos"), Ok("aarch64")) => "darwin-arm64",
        (Ok("macos"), Ok("x86_64")) => "darwin-x64",
        (Ok("windows"), Ok("x86_64")) => "win32-x64",
        // Unsupported targets retain their existing app build; this provider
        // has no approved component there and is unavailable at runtime.
        _ => return,
    };
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/cliproxy");
    let source_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/shared/managed-cliproxy-source.json");
    for path in [root.clone(), source_path.clone()] {
        println!("cargo:rerun-if-changed={}", path.display());
    }
    println!("cargo:rerun-if-changed=src/resource_signature_core.rs");
    let read = |name: &str, limit: u64| {
        let path = root.join(name);
        let metadata = fs::symlink_metadata(&path).unwrap_or_else(|_| {
            panic!("Missing CLIProxy bundle {name}; run package-cliproxy-component.mjs stage")
        });
        assert!(
            metadata.is_file() && !metadata.file_type().is_symlink() && metadata.len() <= limit,
            "Invalid CLIProxy bundle file {name}"
        );
        fs::read(path).expect("read CLIProxy bundle")
    };
    let bytes = read("manifest-v1.json", 256 * 1024);
    let signature_bytes = read("manifest-v1.json.sig", 16 * 1024);
    let signature = std::str::from_utf8(&signature_bytes)
        .expect("CLIProxy signature text")
        .trim();
    crate::resource_signature::verify_minisign_bytes(
        &bytes,
        signature,
        "bundled CLIProxy manifest",
    )
    .expect("CLIProxy bundle must have a valid MyAgents resource signature");
    let manifest: serde_json::Value =
        serde_json::from_slice(&bytes).expect("CLIProxy manifest JSON");
    let source: serde_json::Value =
        serde_json::from_slice(&fs::read(source_path).expect("CLIProxy source pin"))
            .expect("source pin JSON");
    assert_eq!(manifest["schemaVersion"], 1, "CLIProxy manifest schema");
    let releases = manifest["releases"].as_array().expect("CLIProxy releases");
    let minimums: Vec<_> = releases.iter().map(|r| r["compatibility"]["minAppVersion"].as_str().expect("minimum App version")).collect();
    crate::cliproxy_policy::select_release_index(app_version, &minimums).expect("unique version thresholds");
    let pinned: Vec<_> = releases.iter().filter(|r| r["version"] == source["version"] && r["commit"] == source["commit"]).collect();
    let minimums: Vec<_> = pinned.iter().map(|r| r["compatibility"]["minAppVersion"].as_str().unwrap()).collect();
    let selected = crate::cliproxy_policy::select_release_index(app_version, &minimums).expect("valid App policy").expect("compatible bundled baseline");
    let component = pinned[selected];
    for key in ["version", "tag", "commit"] {
        assert_eq!(component[key], source[key], "CLIProxy source pin {key}");
    }
    let artifact = &component["artifacts"][platform];
    assert_eq!(
        artifact["sourceSha256"], source["platforms"][platform]["sha256"],
        "CLIProxy upstream artifact pin"
    );
    let executable = if platform == "win32-x64" {
        "cli-proxy-api.exe"
    } else {
        "cli-proxy-api"
    };
    assert_eq!(
        artifact["executable"], executable,
        "CLIProxy target executable"
    );
    assert!(
        artifact["files"][executable].is_string() && artifact["files"]["LICENSE"].is_string(),
        "CLIProxy executable/license records"
    );
    let archive = read("artifact.zip", 128 * 1024 * 1024);
    assert_eq!(
        artifact["size"].as_u64(),
        Some(archive.len() as u64),
        "CLIProxy bundle size"
    );
    assert_eq!(
        artifact["sha256"].as_str(),
        Some(format!("{:x}", Sha256::digest(&archive)).as_str()),
        "CLIProxy bundle hash"
    );
}
