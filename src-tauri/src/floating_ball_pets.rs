//! Codex-compatible desktop pet pack management.
//!
//! Runtime windows live in `floating_ball.rs`; this module owns filesystem
//! concerns for user-installed pet packs under `~/.myagents/pets`.

use futures_util::StreamExt;
use serde::Serialize;
use std::io::{Cursor, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_SPRITESHEET_BYTES: u64 = 24 * 1024 * 1024;
const MAX_PET_ZIP_BYTES: u64 = 64 * 1024 * 1024;
const MAX_PET_ZIP_ENTRY_BYTES: u64 = 32 * 1024 * 1024;
const MAX_PET_ZIP_TOTAL_UNCOMPRESSED_BYTES: u64 = 64 * 1024 * 1024;
const MAX_PET_ZIP_ENTRIES: usize = 128;
const MAX_PETDEX_PAGE_BYTES: u64 = 2 * 1024 * 1024;
const PETDEX_DOWNLOAD_TIMEOUT_SECS: u64 = 45;
const CODEX_ATLAS_WIDTH: u32 = 1536;
const CODEX_ATLAS_HEIGHT: u32 = 1872;
const CODEX_ATLAS_COLUMNS: u64 = 8;
const CODEX_ATLAS_ROWS: u64 = 9;
const CODEX_ATLAS_CELL_WIDTH: u64 = 192;
const CODEX_ATLAS_CELL_HEIGHT: u64 = 208;
const CODEX_ANIMATION_NAMES: [&str; 9] = [
    "idle",
    "running-right",
    "running-left",
    "waving",
    "jumping",
    "failed",
    "waiting",
    "running",
    "review",
];
const RESERVED_BUILTIN_PET_IDS: [&str; 3] = ["mino-default", "mino-mono", "mino-focus"];
const PETDEX_HOSTS: [&str; 2] = ["petdex.dev", "www.petdex.dev"];
const PETDEX_ASSETS_HOST: &str = "assets.petdex.dev";

static PET_IMPORT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FbPetEntry {
    pub id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub spritesheet_file_path: String,
    pub spritesheet_path: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub atlas: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FbPetImportSummary {
    pub imported: usize,
    pub skipped: usize,
    pub pets: Vec<FbPetEntry>,
}

#[derive(Debug, Clone)]
struct ValidPetManifest {
    id: String,
    display_name: String,
    description: Option<String>,
    author: Option<String>,
    license: Option<String>,
    spritesheet_path: String,
    atlas: Option<serde_json::Value>,
}

fn pets_dir() -> Result<PathBuf, String> {
    crate::app_dirs::myagents_data_dir()
        .map(|dir| dir.join("pets"))
        .ok_or_else(|| "无法定位 ~/.myagents 目录".to_string())
}

fn codex_pets_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".codex").join("pets"))
}

fn validate_absolute_path(path: &Path) -> Result<PathBuf, String> {
    crate::commands::validate_file_path(&path.to_string_lossy())
}

fn canonicalize_checked(path: &Path) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("解析真实路径失败：{} ({})", path.display(), e))?;
    validate_absolute_path(&canonical)
}

fn ensure_directory_no_symlink(path: &Path, label: &str) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(path)
        .map_err(|e| format!("{} 不存在或不可读：{} ({})", label, path.display(), e))?;
    if meta.file_type().is_symlink() {
        return Err(format!("{} 不能是符号链接：{}", label, path.display()));
    }
    if !meta.is_dir() {
        return Err(format!("{} 必须是目录：{}", label, path.display()));
    }
    Ok(())
}

fn ensure_regular_file(path: &Path, label: &str, max_bytes: u64) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(path)
        .map_err(|e| format!("{} 不存在或不可读：{} ({})", label, path.display(), e))?;
    if meta.file_type().is_symlink() {
        return Err(format!("{} 不能是符号链接：{}", label, path.display()));
    }
    if !meta.is_file() {
        return Err(format!("{} 必须是文件：{}", label, path.display()));
    }
    if meta.len() > max_bytes {
        return Err(format!(
            "{} 超过大小上限 {}KB：{}",
            label,
            max_bytes / 1024,
            path.display()
        ));
    }
    Ok(())
}

fn read_json_file(path: &Path) -> Result<serde_json::Value, String> {
    ensure_regular_file(path, "pet.json", MAX_MANIFEST_BYTES)?;
    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("读取 pet.json 失败：{} ({})", path.display(), e))?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取 pet.json 失败：{} ({})", path.display(), e))?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(format!(
            "pet.json 超过大小上限 {}KB：{}",
            MAX_MANIFEST_BYTES / 1024,
            path.display()
        ));
    }
    let content = String::from_utf8(bytes)
        .map_err(|e| format!("pet.json 必须是 UTF-8：{} ({})", path.display(), e))?;
    serde_json::from_str(crate::utils::bom::strip_bom(&content))
        .map_err(|e| format!("解析 pet.json 失败：{} ({})", path.display(), e))
}

fn read_string_field(value: &serde_json::Value, key: &str, max_chars: usize) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(max_chars).collect::<String>())
}

fn is_safe_pet_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() > 64 {
        return false;
    }
    let is_alnum = |b: u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    if !is_alnum(bytes[0]) || !is_alnum(bytes[bytes.len() - 1]) {
        return false;
    }
    bytes.iter().all(|b| is_alnum(*b) || *b == b'-')
}

fn is_safe_spritesheet_path(value: &str) -> bool {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains("..")
        || value.contains(':')
        || value.contains('/')
        || value.contains('\\')
        || value.starts_with('/')
    {
        return false;
    }
    if !value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
    {
        return false;
    }
    let lower = value.to_ascii_lowercase();
    lower.ends_with(".webp") || lower.ends_with(".png")
}

fn read_positive_u64(
    record: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<u64> {
    record.get(key).and_then(|v| v.as_u64()).filter(|v| *v > 0)
}

fn read_non_negative_u64(
    record: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<u64> {
    record.get(key).and_then(|v| v.as_u64())
}

fn validate_frame_animation(
    value: &serde_json::Value,
    rows: u64,
    columns: u64,
    name: &str,
) -> Result<serde_json::Value, String> {
    let Some(record) = value.as_object() else {
        return Err(format!("atlas.animations.{name} 必须是对象"));
    };
    let row = read_non_negative_u64(record, "row")
        .filter(|row| *row < rows)
        .ok_or_else(|| format!("atlas.animations.{name}.row 非法"))?;
    let frames = read_positive_u64(record, "frames")
        .filter(|frames| *frames <= columns)
        .ok_or_else(|| format!("atlas.animations.{name}.frames 非法"))?;
    let durations = record
        .get("frameDurations")
        .and_then(|v| v.as_array())
        .ok_or_else(|| format!("atlas.animations.{name}.frameDurations 必须是数组"))?;
    if durations.len() != frames as usize {
        return Err(format!(
            "atlas.animations.{name}.frameDurations 数量与 frames 不一致"
        ));
    }
    let mut normalized_durations = Vec::with_capacity(durations.len());
    for duration in durations {
        let value = duration
            .as_u64()
            .filter(|value| *value > 0 && *value <= 60_000)
            .ok_or_else(|| format!("atlas.animations.{name}.frameDurations 包含非法时长"))?;
        normalized_durations.push(serde_json::Value::from(value));
    }
    Ok(serde_json::json!({
        "row": row,
        "frames": frames,
        "frameDurations": normalized_durations,
    }))
}

fn validate_atlas_value(value: &serde_json::Value) -> Result<serde_json::Value, String> {
    let Some(record) = value.as_object() else {
        return Err("atlas 必须是对象".to_string());
    };
    let columns =
        read_positive_u64(record, "columns").ok_or_else(|| "atlas.columns 非法".to_string())?;
    let rows = read_positive_u64(record, "rows").ok_or_else(|| "atlas.rows 非法".to_string())?;
    let cell_width =
        read_positive_u64(record, "cellWidth").ok_or_else(|| "atlas.cellWidth 非法".to_string())?;
    let cell_height = read_positive_u64(record, "cellHeight")
        .ok_or_else(|| "atlas.cellHeight 非法".to_string())?;
    if columns != CODEX_ATLAS_COLUMNS
        || rows != CODEX_ATLAS_ROWS
        || cell_width != CODEX_ATLAS_CELL_WIDTH
        || cell_height != CODEX_ATLAS_CELL_HEIGHT
    {
        return Err("atlas 必须匹配 Codex Pets 8×9 / 192×208 协议".to_string());
    }
    let animations = record
        .get("animations")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "atlas.animations 必须是对象".to_string())?;
    let mut normalized_animations = serde_json::Map::new();
    for name in CODEX_ANIMATION_NAMES {
        let value = animations
            .get(name)
            .ok_or_else(|| format!("atlas.animations 缺少 {name}"))?;
        normalized_animations.insert(
            name.to_string(),
            validate_frame_animation(value, rows, columns, name)?,
        );
    }
    Ok(serde_json::json!({
        "columns": columns,
        "rows": rows,
        "cellWidth": cell_width,
        "cellHeight": cell_height,
        "animations": normalized_animations,
    }))
}

fn validate_manifest(
    value: serde_json::Value,
    manifest_path: &Path,
) -> Result<ValidPetManifest, String> {
    let id = read_string_field(&value, "id", 64)
        .ok_or_else(|| format!("pet.json 缺少 id：{}", manifest_path.display()))?;
    if !is_safe_pet_id(&id) {
        return Err(format!("pet.json id 不安全：{}", id));
    }
    if RESERVED_BUILTIN_PET_IDS.contains(&id.as_str()) {
        return Err(format!("pet.json id 与内置样式冲突：{}", id));
    }
    let spritesheet_path = read_string_field(&value, "spritesheetPath", 128)
        .ok_or_else(|| format!("pet.json 缺少 spritesheetPath：{}", manifest_path.display()))?;
    if !is_safe_spritesheet_path(&spritesheet_path) {
        return Err(format!("spritesheetPath 不安全：{}", spritesheet_path));
    }
    let display_name = read_string_field(&value, "displayName", 80)
        .or_else(|| read_string_field(&value, "name", 80))
        .unwrap_or_else(|| id.clone());
    let atlas = value
        .get("atlas")
        .map(validate_atlas_value)
        .transpose()
        .map_err(|e| format!("pet.json atlas 非法：{} ({})", e, manifest_path.display()))?;
    Ok(ValidPetManifest {
        id,
        display_name,
        description: read_string_field(&value, "description", 300),
        author: read_string_field(&value, "author", 120),
        license: read_string_field(&value, "license", 120),
        spritesheet_path,
        atlas,
    })
}

fn validate_spritesheet_dimensions(path: &Path) -> Result<(), String> {
    ensure_regular_file(path, "spritesheet", MAX_SPRITESHEET_BYTES)?;
    let reader = image::ImageReader::open(path)
        .map_err(|e| format!("读取 spritesheet 失败：{} ({})", path.display(), e))?
        .with_guessed_format()
        .map_err(|e| format!("识别 spritesheet 格式失败：{} ({})", path.display(), e))?;
    let (width, height) = reader
        .into_dimensions()
        .map_err(|e| format!("读取 spritesheet 尺寸失败：{} ({})", path.display(), e))?;
    if width != CODEX_ATLAS_WIDTH || height != CODEX_ATLAS_HEIGHT {
        return Err(format!(
            "spritesheet 尺寸必须是 {}×{}，当前是 {}×{}：{}",
            CODEX_ATLAS_WIDTH,
            CODEX_ATLAS_HEIGHT,
            width,
            height,
            path.display()
        ));
    }
    Ok(())
}

fn ensure_child_of(child: &Path, parent: &Path, label: &str) -> Result<(), String> {
    if !child.starts_with(parent) {
        return Err(format!("{} 不在允许目录内：{}", label, child.display()));
    }
    Ok(())
}

fn prepare_source_root(raw_root: &Path) -> Result<PathBuf, String> {
    validate_absolute_path(raw_root)?;
    ensure_directory_no_symlink(raw_root, "pet 目录")?;
    canonicalize_checked(raw_root)
}

fn read_pet_entry(root: &Path, source: &str) -> Result<FbPetEntry, String> {
    let root_canon = prepare_source_root(root)?;
    let manifest_path = root_canon.join("pet.json");
    let manifest = validate_manifest(read_json_file(&manifest_path)?, &manifest_path)?;
    let spritesheet_path = root_canon.join(&manifest.spritesheet_path);
    validate_spritesheet_dimensions(&spritesheet_path)?;
    let spritesheet_canon = canonicalize_checked(&spritesheet_path)?;
    ensure_child_of(&spritesheet_canon, &root_canon, "spritesheet")?;
    let spritesheet_file_path = crate::sidecar::normalize_external_path(spritesheet_canon)
        .to_string_lossy()
        .to_string();
    Ok(FbPetEntry {
        id: manifest.id,
        display_name: manifest.display_name,
        description: manifest.description,
        author: manifest.author,
        license: manifest.license,
        spritesheet_file_path,
        spritesheet_path: manifest.spritesheet_path,
        source: source.to_string(),
        atlas: manifest.atlas,
    })
}

fn remove_path_if_exists(path: &Path) -> Result<(), String> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("读取路径元数据失败：{} ({})", path.display(), e)),
    };
    if meta.file_type().is_symlink() || meta.is_file() {
        std::fs::remove_file(path).map_err(|e| format!("删除文件失败：{} ({})", path.display(), e))
    } else if meta.is_dir() {
        std::fs::remove_dir_all(path)
            .map_err(|e| format!("删除目录失败：{} ({})", path.display(), e))
    } else {
        Err(format!("不支持的路径类型：{}", path.display()))
    }
}

fn is_zip_file_path(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
}

fn find_manifest_root(raw_path: &str) -> Result<PathBuf, String> {
    let path = crate::commands::validate_file_path(raw_path)?;
    let meta = std::fs::symlink_metadata(&path)
        .map_err(|e| format!("导入路径不存在或不可读：{} ({})", path.display(), e))?;
    if meta.file_type().is_symlink() {
        return Err(format!("导入路径不能是符号链接：{}", path.display()));
    }
    if meta.is_dir() {
        return prepare_source_root(&path);
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("无法定位 pet.json 所在目录：{}", path.display()))?;
    prepare_source_root(parent)
}

fn collect_pet_manifest_paths(
    dir: &Path,
    manifests: &mut Vec<PathBuf>,
    depth: usize,
) -> Result<(), String> {
    if depth > 8 {
        return Err(format!("zip 解包目录层级过深：{}", dir.display()));
    }
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("读取 zip 解包目录失败：{} ({})", dir.display(), e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let meta = std::fs::symlink_metadata(&path)
            .map_err(|e| format!("读取 zip 解包路径失败：{} ({})", path.display(), e))?;
        if meta.file_type().is_symlink() {
            return Err(format!("zip 解包结果不能包含符号链接：{}", path.display()));
        }
        if meta.is_dir() {
            collect_pet_manifest_paths(&path, manifests, depth + 1)?;
        } else if meta.is_file()
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case("pet.json"))
        {
            manifests.push(path);
        }
    }
    Ok(())
}

fn find_extracted_pet_root(root: &Path) -> Result<PathBuf, String> {
    let mut manifests = Vec::new();
    collect_pet_manifest_paths(root, &mut manifests, 0)?;
    match manifests.len() {
        0 => Err("zip 包内缺少 pet.json".to_string()),
        1 => manifests[0]
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法定位 zip 包内 pet.json 所在目录".to_string()),
        _ => Err("zip 包内包含多个 pet.json，请只导入一个桌宠素材包".to_string()),
    }
}

fn copy_limited_zip_entry<R: Read, W: Write>(
    reader: &mut R,
    writer: &mut W,
    entry_name: &str,
    label: &str,
    entry_limit: u64,
    total_limit: u64,
    total_uncompressed: &mut u64,
) -> Result<(), String> {
    let mut buf = [0_u8; 16 * 1024];
    let mut entry_copied = 0_u64;
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("解包 zip 条目失败：{} ({})", entry_name, e))?;
        if n == 0 {
            return Ok(());
        }
        let n_u64 = n as u64;
        entry_copied = entry_copied
            .checked_add(n_u64)
            .ok_or_else(|| "zip 条目解压后大小溢出".to_string())?;
        if entry_copied > entry_limit {
            return Err(format!(
                "zip 包条目超过大小上限 {}MB：{}",
                entry_limit / 1024 / 1024,
                entry_name
            ));
        }
        *total_uncompressed = total_uncompressed
            .checked_add(n_u64)
            .ok_or_else(|| "zip 包解压后大小溢出".to_string())?;
        if *total_uncompressed > total_limit {
            return Err(format!(
                "zip 包解压后超过大小上限 {}MB：{}",
                total_limit / 1024 / 1024,
                label
            ));
        }
        writer
            .write_all(&buf[..n])
            .map_err(|e| format!("写入 zip 解包文件失败：{} ({})", entry_name, e))?;
    }
}

fn extract_pet_zip_to_temp<R: Read + Seek>(
    reader: R,
    temp_root: &Path,
    label: &str,
) -> Result<(), String> {
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|e| format!("读取 zip 失败：{} ({})", label, e))?;
    if archive.is_empty() {
        return Err(format!("zip 包为空：{}", label));
    }
    if archive.len() > MAX_PET_ZIP_ENTRIES {
        return Err(format!(
            "zip 包文件数量超过上限 {}：{}",
            MAX_PET_ZIP_ENTRIES, label
        ));
    }

    let mut total_uncompressed = 0_u64;
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|e| format!("读取 zip 条目失败：{} ({})", label, e))?;
        if file.is_dir() {
            continue;
        }
        if !file.is_file() {
            return Err(format!("zip 包不能包含符号链接或特殊文件：{}", file.name()));
        }
        let entry_name = file.name().to_string();
        if file.size() > MAX_PET_ZIP_ENTRY_BYTES {
            return Err(format!(
                "zip 包条目超过大小上限 {}MB：{}",
                MAX_PET_ZIP_ENTRY_BYTES / 1024 / 1024,
                entry_name
            ));
        }

        let enclosed = file
            .enclosed_name()
            .ok_or_else(|| format!("zip 包条目路径不安全：{}", entry_name))?;
        let dest = temp_root.join(&enclosed);
        ensure_child_of(&dest, temp_root, "zip 条目")?;
        if std::fs::symlink_metadata(&dest).is_ok() {
            return Err(format!("zip 包包含重复文件路径：{}", enclosed.display()));
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建 zip 解包目录失败：{} ({})", parent.display(), e))?;
        }
        let mut out = std::fs::File::create(&dest)
            .map_err(|e| format!("创建 zip 解包文件失败：{} ({})", dest.display(), e))?;
        copy_limited_zip_entry(
            &mut file,
            &mut out,
            &entry_name,
            label,
            MAX_PET_ZIP_ENTRY_BYTES,
            MAX_PET_ZIP_TOTAL_UNCOMPRESSED_BYTES,
            &mut total_uncompressed,
        )?;
    }
    Ok(())
}

fn import_pet_zip_reader<R: Read + Seek>(
    reader: R,
    label: &str,
) -> Result<FbPetImportSummary, String> {
    let pets_root = pets_dir()?;
    std::fs::create_dir_all(&pets_root)
        .map_err(|e| format!("创建 pets 目录失败：{} ({})", pets_root.display(), e))?;
    let pets_root_canon = canonicalize_checked(&pets_root)?;
    let temp_root = pets_root_canon.join(format!(".zip-source-{}", uuid::Uuid::new_v4()));
    remove_path_if_exists(&temp_root)?;
    std::fs::create_dir_all(&temp_root)
        .map_err(|e| format!("创建 zip 临时目录失败：{} ({})", temp_root.display(), e))?;

    let result = (|| {
        extract_pet_zip_to_temp(reader, &temp_root, label)?;
        let source_root = find_extracted_pet_root(&temp_root)?;
        let pet = import_pet_from_root(&source_root)?;
        Ok(FbPetImportSummary {
            imported: 1,
            skipped: 0,
            pets: vec![pet],
        })
    })();

    if let Err(err) = remove_path_if_exists(&temp_root) {
        crate::ulog_warn!(
            "[fb-pet] failed to cleanup zip import temp {}: {}",
            temp_root.display(),
            err
        );
    }
    result
}

fn import_pet_zip_file(path: &Path) -> Result<FbPetImportSummary, String> {
    ensure_regular_file(path, "zip 文件", MAX_PET_ZIP_BYTES)?;
    let file = std::fs::File::open(path)
        .map_err(|e| format!("读取 zip 文件失败：{} ({})", path.display(), e))?;
    import_pet_zip_reader(file, &path.to_string_lossy())
}

fn import_pet_zip_bytes(bytes: Vec<u8>, label: &str) -> Result<FbPetImportSummary, String> {
    if bytes.len() as u64 > MAX_PET_ZIP_BYTES {
        return Err(format!(
            "zip 包超过大小上限 {}MB：{}",
            MAX_PET_ZIP_BYTES / 1024 / 1024,
            label
        ));
    }
    import_pet_zip_reader(Cursor::new(bytes), label)
}

fn import_pet_from_root(root: &Path) -> Result<FbPetEntry, String> {
    let _guard = PET_IMPORT_LOCK
        .lock()
        .map_err(|_| "pets 导入锁已损坏".to_string())?;
    let root_canon = prepare_source_root(root)?;
    let manifest_path = root_canon.join("pet.json");
    let manifest = validate_manifest(read_json_file(&manifest_path)?, &manifest_path)?;
    let source_sheet = root_canon.join(&manifest.spritesheet_path);
    validate_spritesheet_dimensions(&source_sheet)?;
    let source_sheet_canon = canonicalize_checked(&source_sheet)?;
    ensure_child_of(&source_sheet_canon, &root_canon, "spritesheet")?;

    let pets_root = pets_dir()?;
    std::fs::create_dir_all(&pets_root)
        .map_err(|e| format!("创建 pets 目录失败：{} ({})", pets_root.display(), e))?;
    let pets_root_canon = canonicalize_checked(&pets_root)?;
    let dest = pets_root_canon.join(&manifest.id);

    if root_canon == dest {
        return read_pet_entry(&dest, "myagents");
    }

    let tmp = pets_root_canon.join(format!(".import-{}-{}", manifest.id, uuid::Uuid::new_v4()));
    remove_path_if_exists(&tmp)?;
    std::fs::create_dir_all(&tmp)
        .map_err(|e| format!("创建临时目录失败：{} ({})", tmp.display(), e))?;
    std::fs::copy(&manifest_path, tmp.join("pet.json"))
        .map_err(|e| format!("复制 pet.json 失败：{} ({})", manifest_path.display(), e))?;
    std::fs::copy(&source_sheet_canon, tmp.join(&manifest.spritesheet_path)).map_err(|e| {
        format!(
            "复制 spritesheet 失败：{} ({})",
            source_sheet_canon.display(),
            e
        )
    })?;

    let backup = pets_root_canon.join(format!(".backup-{}-{}", manifest.id, uuid::Uuid::new_v4()));
    let had_existing = match std::fs::symlink_metadata(&dest) {
        Ok(_) => true,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(e) => return Err(format!("读取已安装 pet 失败：{} ({})", dest.display(), e)),
    };
    if had_existing {
        remove_path_if_exists(&backup)?;
        std::fs::rename(&dest, &backup).map_err(|e| {
            format!(
                "备份已安装 pet 失败：{} -> {} ({})",
                dest.display(),
                backup.display(),
                e
            )
        })?;
    }

    if let Err(e) = std::fs::rename(&tmp, &dest) {
        if had_existing {
            let _ = std::fs::rename(&backup, &dest);
        }
        return Err(format!(
            "安装 pet 目录失败：{} -> {} ({})",
            tmp.display(),
            dest.display(),
            e
        ));
    }
    if had_existing {
        let _ = remove_path_if_exists(&backup);
    }
    read_pet_entry(&dest, "myagents")
}

fn list_pet_dirs(root: &Path, source: &str) -> Result<Vec<FbPetEntry>, String> {
    let mut pets = Vec::new();
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(pets),
        Err(e) => return Err(format!("读取 pets 目录失败：{} ({})", root.display(), e)),
    };
    let root_canon = canonicalize_checked(root)?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() || !meta.is_dir() {
            continue;
        }
        let Ok(path_canon) = canonicalize_checked(&path) else {
            continue;
        };
        if ensure_child_of(&path_canon, &root_canon, "pet 目录").is_err() {
            continue;
        }
        match read_pet_entry(&path_canon, source) {
            Ok(pet) => pets.push(pet),
            Err(err) => crate::ulog_warn!("[fb-pet] skip invalid pet {}: {}", path.display(), err),
        }
    }
    pets.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    Ok(pets)
}

fn list_installed_pets_blocking() -> Result<Vec<FbPetEntry>, String> {
    let root = pets_dir()?;
    list_pet_dirs(&root, "myagents")
}

fn delete_installed_pet_blocking(id: String) -> Result<(), String> {
    let id = id.trim().to_string();
    if !is_safe_pet_id(&id) {
        return Err("宠物 ID 不安全".to_string());
    }
    if RESERVED_BUILTIN_PET_IDS.contains(&id.as_str()) {
        return Err("内置宠物不能删除".to_string());
    }

    let root = pets_dir()?;
    let root_meta = match std::fs::symlink_metadata(&root) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("读取 pets 目录失败：{} ({})", root.display(), e)),
    };
    if root_meta.file_type().is_symlink() || !root_meta.is_dir() {
        return Err(format!("pets 目录非法：{}", root.display()));
    }
    let root_canon = canonicalize_checked(&root)?;
    let target = root_canon.join(&id);
    let target_meta = match std::fs::symlink_metadata(&target) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("读取宠物目录失败：{} ({})", target.display(), e)),
    };
    if target_meta.file_type().is_symlink() {
        return Err(format!("宠物目录不能是符号链接：{}", target.display()));
    }
    if !target_meta.is_dir() {
        return Err(format!("宠物目录非法：{}", target.display()));
    }
    let target_canon = canonicalize_checked(&target)?;
    ensure_child_of(&target_canon, &root_canon, "pet 目录")?;
    std::fs::remove_dir_all(&target_canon)
        .map_err(|e| format!("删除宠物素材失败：{} ({})", target_canon.display(), e))
}

fn import_pet_path_blocking(path: String) -> Result<FbPetImportSummary, String> {
    let validated = crate::commands::validate_file_path(&path)?;
    let meta = std::fs::symlink_metadata(&validated)
        .map_err(|e| format!("导入路径不存在或不可读：{} ({})", validated.display(), e))?;
    if meta.file_type().is_symlink() {
        return Err(format!("导入路径不能是符号链接：{}", validated.display()));
    }
    if meta.is_file() && is_zip_file_path(&validated) {
        return import_pet_zip_file(&validated);
    }
    let root = find_manifest_root(&path)?;
    let pet = import_pet_from_root(&root)?;
    Ok(FbPetImportSummary {
        imported: 1,
        skipped: 0,
        pets: vec![pet],
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PetdexImportSource {
    Page(reqwest::Url),
    Zip(reqwest::Url),
}

fn is_safe_petdex_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 96
        && slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn is_petdex_zip_url(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some(PETDEX_ASSETS_HOST)
        && url.path().starts_with("/pets/")
        && url.path().ends_with("/zip.zip")
}

fn parse_petdex_import_source(input: &str) -> Result<PetdexImportSource, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("请输入 Petdex 链接".to_string());
    }
    let mut url =
        reqwest::Url::parse(trimmed).map_err(|e| format!("Petdex 链接格式不正确：{}", e))?;
    if is_petdex_zip_url(&url) {
        url.set_query(None);
        url.set_fragment(None);
        return Ok(PetdexImportSource::Zip(url));
    }

    if url.scheme() != "https" || !PETDEX_HOSTS.contains(&url.host_str().unwrap_or("")) {
        return Err("只支持 https://petdex.dev/pets/... 链接".to_string());
    }
    let segments: Vec<&str> = url
        .path_segments()
        .ok_or_else(|| "Petdex 链接路径不正确".to_string())?
        .filter(|segment| !segment.is_empty())
        .collect();
    let pet_index = segments
        .iter()
        .position(|segment| *segment == "pets")
        .ok_or_else(|| "Petdex 链接必须指向 /pets/<name>".to_string())?;
    if pet_index > 1 || segments.len() != pet_index + 2 {
        return Err("Petdex 链接必须指向单个宠物页面".to_string());
    }
    let slug = segments[pet_index + 1];
    if !is_safe_petdex_slug(slug) {
        return Err("Petdex 宠物名称不安全".to_string());
    }
    url.set_query(None);
    url.set_fragment(None);
    Ok(PetdexImportSource::Page(url))
}

fn is_allowed_petdex_fetch_url(url: &reqwest::Url) -> bool {
    if is_petdex_zip_url(url) {
        return true;
    }
    parse_petdex_import_source(url.as_str()).is_ok()
}

fn extract_petdex_zip_url(page_html: &str) -> Result<reqwest::Url, String> {
    let mut rest = page_html;
    while let Some(offset) = rest.find("https://") {
        let candidate_start = &rest[offset..];
        let end = candidate_start
            .find(|c: char| {
                !(c.is_ascii_alphanumeric()
                    || matches!(c, ':' | '/' | '.' | '-' | '_' | '%' | '?' | '='))
            })
            .unwrap_or(candidate_start.len());
        let candidate = &candidate_start[..end];
        if let Ok(mut url) = reqwest::Url::parse(candidate) {
            url.set_query(None);
            url.set_fragment(None);
            if is_petdex_zip_url(&url) {
                return Ok(url);
            }
        }
        rest = &candidate_start[end..];
    }
    Err("Petdex 页面里没有找到可下载的 zip 包".to_string())
}

fn build_external_http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    // External host — system/user proxy is wanted here. The allow is required by
    // the repo-wide localhost no_proxy lint; proxy_config owns the final client.
    #[allow(clippy::disallowed_methods)]
    let builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("too many Petdex redirects");
            }
            if is_allowed_petdex_fetch_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("Petdex redirect target is not allowed")
            }
        }))
        .user_agent(format!("MyAgents/{}", env!("CARGO_PKG_VERSION")));
    crate::proxy_config::build_client_with_proxy(builder)
}

async fn download_limited_bytes(
    client: &reqwest::Client,
    url: reqwest::Url,
    max_bytes: u64,
    label: &str,
) -> Result<Vec<u8>, String> {
    let response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|e| format!("下载 {} 失败：{} ({})", label, url, e))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("下载 {} 失败：HTTP {} ({})", label, status, url));
    }
    if let Some(length) = response.content_length() {
        if length > max_bytes {
            return Err(format!(
                "{} 超过大小上限 {}MB：{}",
                label,
                max_bytes / 1024 / 1024,
                url
            ));
        }
    }

    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取 {} 下载内容失败：{} ({})", label, url, e))?;
        if bytes.len() as u64 + chunk.len() as u64 > max_bytes {
            return Err(format!(
                "{} 超过大小上限 {}MB：{}",
                label,
                max_bytes / 1024 / 1024,
                url
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn resolve_petdex_zip_url(
    client: &reqwest::Client,
    source: PetdexImportSource,
) -> Result<reqwest::Url, String> {
    match source {
        PetdexImportSource::Zip(url) => Ok(url),
        PetdexImportSource::Page(url) => {
            let page_bytes =
                download_limited_bytes(client, url, MAX_PETDEX_PAGE_BYTES, "Petdex 页面").await?;
            let page_html = String::from_utf8(page_bytes)
                .map_err(|e| format!("Petdex 页面不是 UTF-8：{}", e))?;
            extract_petdex_zip_url(&page_html)
        }
    }
}

async fn import_petdex_link(url: String) -> Result<FbPetImportSummary, String> {
    let source = parse_petdex_import_source(&url)?;
    let client = build_external_http_client(PETDEX_DOWNLOAD_TIMEOUT_SECS)?;
    let zip_url = resolve_petdex_zip_url(&client, source).await?;
    let zip_label = zip_url.to_string();
    let zip_bytes =
        download_limited_bytes(&client, zip_url, MAX_PET_ZIP_BYTES, "Petdex zip").await?;
    tauri::async_runtime::spawn_blocking(move || import_pet_zip_bytes(zip_bytes, &zip_label))
        .await
        .map_err(|e| format!("[fb-pet] petdex import join: {e}"))?
}

fn import_codex_pets_blocking() -> Result<FbPetImportSummary, String> {
    let Some(root) = codex_pets_dir() else {
        return Err("无法定位 ~/.codex/pets".to_string());
    };
    let entries = match std::fs::read_dir(&root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(FbPetImportSummary {
                imported: 0,
                skipped: 0,
                pets: Vec::new(),
            });
        }
        Err(e) => {
            return Err(format!(
                "读取 Codex pets 目录失败：{} ({})",
                root.display(),
                e
            ))
        }
    };
    let root_canon = canonicalize_checked(&root)?;

    let mut imported = 0;
    let mut skipped = 0;
    let mut pets = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            skipped += 1;
            continue;
        };
        if meta.file_type().is_symlink() || !meta.is_dir() {
            continue;
        }
        let Ok(path_canon) = canonicalize_checked(&path) else {
            skipped += 1;
            continue;
        };
        if ensure_child_of(&path_canon, &root_canon, "Codex pet 目录").is_err() {
            skipped += 1;
            continue;
        }
        match import_pet_from_root(&path_canon) {
            Ok(pet) => {
                imported += 1;
                pets.push(pet);
            }
            Err(err) => {
                skipped += 1;
                crate::ulog_warn!("[fb-pet] skip Codex pet {}: {}", path.display(), err);
            }
        }
    }
    pets.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    Ok(FbPetImportSummary {
        imported,
        skipped,
        pets,
    })
}

#[tauri::command]
pub async fn cmd_fb_pet_list_installed() -> Result<Vec<FbPetEntry>, String> {
    tauri::async_runtime::spawn_blocking(list_installed_pets_blocking)
        .await
        .map_err(|e| format!("[fb-pet] list join: {e}"))?
}

#[tauri::command]
pub async fn cmd_fb_pet_delete_installed(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_installed_pet_blocking(id))
        .await
        .map_err(|e| format!("[fb-pet] delete join: {e}"))?
}

#[tauri::command]
pub async fn cmd_fb_pet_import_path(path: String) -> Result<FbPetImportSummary, String> {
    tauri::async_runtime::spawn_blocking(move || import_pet_path_blocking(path))
        .await
        .map_err(|e| format!("[fb-pet] import join: {e}"))?
}

#[tauri::command]
pub async fn cmd_fb_pet_import_codex() -> Result<FbPetImportSummary, String> {
    tauri::async_runtime::spawn_blocking(import_codex_pets_blocking)
        .await
        .map_err(|e| format!("[fb-pet] codex import join: {e}"))?
}

#[tauri::command]
pub async fn cmd_fb_pet_import_petdex(url: String) -> Result<FbPetImportSummary, String> {
    import_petdex_link(url).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_petdex_page_urls() {
        assert_eq!(
            parse_petdex_import_source("https://petdex.dev/pets/bluebow").unwrap(),
            PetdexImportSource::Page(
                reqwest::Url::parse("https://petdex.dev/pets/bluebow").unwrap()
            )
        );
        assert_eq!(
            parse_petdex_import_source("https://petdex.dev/zh/pets/bluebow?ref=x#install").unwrap(),
            PetdexImportSource::Page(
                reqwest::Url::parse("https://petdex.dev/zh/pets/bluebow").unwrap()
            )
        );
    }

    #[test]
    fn parses_petdex_asset_zip_urls() {
        let url = "https://assets.petdex.dev/pets/bluebow-c8b9e9491708/zip.zip?download=1";
        assert_eq!(
            parse_petdex_import_source(url).unwrap(),
            PetdexImportSource::Zip(
                reqwest::Url::parse("https://assets.petdex.dev/pets/bluebow-c8b9e9491708/zip.zip")
                    .unwrap()
            )
        );
    }

    #[test]
    fn rejects_non_petdex_urls() {
        assert!(parse_petdex_import_source("https://example.com/pets/bluebow").is_err());
        assert!(parse_petdex_import_source("http://petdex.dev/pets/bluebow").is_err());
        assert!(parse_petdex_import_source("https://petdex.dev/pets/../bluebow").is_err());
    }

    #[test]
    fn validates_petdex_redirect_targets() {
        let page = reqwest::Url::parse("https://www.petdex.dev/pets/bluebow").unwrap();
        let zip =
            reqwest::Url::parse("https://assets.petdex.dev/pets/bluebow-c8b9e9491708/zip.zip")
                .unwrap();
        let private = reqwest::Url::parse("http://127.0.0.1:8080/pets/bluebow").unwrap();
        let wrong_asset =
            reqwest::Url::parse("https://assets.petdex.dev/not-pets/bluebow/zip.zip").unwrap();

        assert!(is_allowed_petdex_fetch_url(&page));
        assert!(is_allowed_petdex_fetch_url(&zip));
        assert!(!is_allowed_petdex_fetch_url(&private));
        assert!(!is_allowed_petdex_fetch_url(&wrong_asset));
    }

    #[test]
    fn bounded_zip_copy_stops_before_entry_limit_overflow() {
        let mut input = Cursor::new(vec![1_u8, 2, 3, 4]);
        let mut output = Vec::new();
        let mut total = 0_u64;
        let err = copy_limited_zip_entry(
            &mut input,
            &mut output,
            "big.bin",
            "test.zip",
            3,
            10,
            &mut total,
        )
        .unwrap_err();

        assert!(err.contains("zip 包条目超过大小上限"));
        assert!(output.is_empty());
    }

    #[test]
    fn bounded_zip_copy_stops_before_total_limit_overflow() {
        let mut input = Cursor::new(vec![1_u8, 2, 3, 4]);
        let mut output = Vec::new();
        let mut total = 2_u64;
        let err = copy_limited_zip_entry(
            &mut input,
            &mut output,
            "nested.bin",
            "test.zip",
            10,
            5,
            &mut total,
        )
        .unwrap_err();

        assert!(err.contains("zip 包解压后超过大小上限"));
        assert!(output.is_empty());
    }

    #[test]
    fn extracts_zip_url_from_petdex_html() {
        let html = r#"self.__next_f.push([1,"zipUrl\":\"https://assets.petdex.dev/pets/bluebow-c8b9e9491708/zip.zip\""])"#;
        assert_eq!(
            extract_petdex_zip_url(html).unwrap(),
            reqwest::Url::parse("https://assets.petdex.dev/pets/bluebow-c8b9e9491708/zip.zip")
                .unwrap()
        );
    }

    #[test]
    fn extracts_zip_url_before_html_entities() {
        let html = r#"<div data-url="https://assets.petdex.dev/pets/bluebow-c8b9e9491708/zip.zip&quot;"></div>"#;
        assert_eq!(
            extract_petdex_zip_url(html).unwrap(),
            reqwest::Url::parse("https://assets.petdex.dev/pets/bluebow-c8b9e9491708/zip.zip")
                .unwrap()
        );
    }
}
