//! Read-only product transcript V2 codec. SessionStore remains the only writer.
//! The raw wire fixtures are shared with Node; neither runtime's native history
//! nor the search index can repair or choose a different product history.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Arc;

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

const MAX_LINE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
type Result<T> = std::result::Result<T, String>;

#[derive(Debug, PartialEq, Eq)]
pub enum TranscriptFormat {
    Legacy,
    V2,
    Conflict,
    Unsupported,
    Unindexed,
}

pub fn resolve_format(
    metadata: Option<&Value>,
    legacy_exists: bool,
    v2_exists: bool,
) -> TranscriptFormat {
    let Some(metadata) = metadata else {
        return TranscriptFormat::Unindexed;
    };
    match metadata.get("transcriptFormat") {
        Some(value) if value.as_f64() == Some(2.0) => {
            if legacy_exists {
                TranscriptFormat::Conflict
            } else {
                TranscriptFormat::V2
            }
        }
        Some(_) => TranscriptFormat::Unsupported,
        None if v2_exists => TranscriptFormat::Conflict,
        None => TranscriptFormat::Legacy,
    }
}

pub fn session_format(
    data_dir: &Path,
    session_id: &str,
    metadata: Option<&Value>,
) -> Result<TranscriptFormat> {
    if !is_valid_session_id(session_id) {
        return Err("Invalid product session ID".into());
    }
    let legacy = data_dir.join("sessions");
    Ok(resolve_format(
        metadata,
        legacy.join(format!("{session_id}.jsonl")).exists()
            || legacy.join(format!("{session_id}.json")).exists(),
        data_dir
            .join("sessions-v2")
            .join(format!("{session_id}.jsonl"))
            .exists(),
    ))
}

pub fn is_valid_session_id(id: &str) -> bool {
    !id.is_empty() && id.len() < 100 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

#[derive(Default, Debug)]
pub struct Projection {
    pub messages: HashMap<String, Arc<Value>>,
    pub order: Vec<String>,
    pub turns: HashMap<String, Arc<Value>>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Tail {
    Clean,
    Incomplete,
    Invalid,
}

#[derive(Debug)]
pub struct Transcript {
    pub generation: String,
    pub revision: u64,
    pub last_batch_id: Option<String>,
    pub valid_bytes: u64,
    pub tail: Tail,
    pub projection: Projection,
    baseline_complete: bool,
    base_revision: u64,
    header_line: String,
    // The accepted last batch is checked before resuming the byte cursor. A
    // replacement, truncation or repaired tail cannot masquerade as append.
    last_line_start: u64,
    last_line: String,
}

fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing string: {key}"))
}
fn integer(value: &Value, key: &str) -> Result<u64> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite() && *n >= 0.0 && n.fract() == 0.0 && *n <= MAX_SAFE_INTEGER as f64)
        .map(|n| n as u64)
        .ok_or_else(|| format!("Invalid integer: {key}"))
}
fn array<'a>(value: &'a Value, key: &str) -> Result<&'a Vec<Value>> {
    value
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("Missing array: {key}"))
}
fn strings(value: &Value, key: &str) -> Result<Vec<String>> {
    array(value, key)?
        .iter()
        .map(|v| {
            v.as_str()
                .map(str::to_owned)
                .ok_or_else(|| "Invalid string array".into())
        })
        .collect()
}
fn object<'a>(value: &'a Value, key: &str) -> Result<&'a Map<String, Value>> {
    value
        .get(key)
        .and_then(Value::as_object)
        .ok_or_else(|| format!("Missing object: {key}"))
}
fn content(value: &Value) -> bool {
    value.is_string()
        || value.as_array().is_some_and(|blocks| {
            blocks
                .iter()
                .all(|b| b.is_object() && string(b, "id").is_ok() && string(b, "type").is_ok())
        })
}
const MESSAGE_DETAILS: &[&str] = &[
    "asyncQuestionReply",
    "sdkUuid",
    "runtimeTurnAnchor",
    "attachments",
    "usage",
    "toolCount",
    "durationMs",
    "metadata",
    "turnId",
    "transcriptState",
];

fn validate_operation(op: &Value) -> Result<()> {
    match string(op, "kind")? {
        "message-create" => {
            let message = op.get("message").ok_or("Missing message")?;
            string(message, "id")?;
            string(message, "timestamp")?;
            if !matches!(string(message, "role")?, "user" | "assistant")
                || !message.get("content").is_some_and(content)
            {
                return Err("Invalid message".into());
            }
        }
        "message-update" => {
            string(op, "messageId")?;
            if !object(op, "details")?
                .keys()
                .all(|k| MESSAGE_DETAILS.contains(&k.as_str()))
            {
                return Err("Invalid message details".into());
            }
            if op.get("clear").is_some()
                && !strings(op, "clear")?
                    .iter()
                    .all(|k| MESSAGE_DETAILS.contains(&k.as_str()))
            {
                return Err("Invalid cleared fields".into());
            }
        }
        "content-confirm" => {
            string(op, "messageId")?;
            if !op.get("content").is_some_and(content) {
                return Err("Invalid content".into());
            }
        }
        "block-upsert" => {
            string(op, "messageId")?;
            let block = op.get("block").ok_or("Missing block")?;
            string(block, "id")?;
            string(block, "type")?;
        }
        "blocks-remove" => {
            string(op, "messageId")?;
            strings(op, "blockIds")?;
        }
        "block-update" => {
            string(op, "messageId")?;
            string(op, "blockId")?;
            let target = string(op, "target")?;
            if !matches!(target, "block" | "tool")
                || object(op, "details")?
                    .keys()
                    .any(|k| ["id", "type", "tool"].contains(&k.as_str()))
            {
                return Err("Invalid block update".into());
            }
            if op.get("subagentToolId").is_some() {
                string(op, "subagentToolId")?;
                if target != "tool" {
                    return Err("Invalid nested target".into());
                }
            }
        }
        "subagents-remove" => {
            string(op, "messageId")?;
            string(op, "blockId")?;
            strings(op, "toolIds")?;
        }
        "subagent-upsert" => {
            string(op, "messageId")?;
            string(op, "blockId")?;
            string(op.get("call").ok_or("Missing call")?, "id")?;
        }
        "text-append" => {
            string(op, "messageId")?;
            string(op, "text")?;
            integer(op, "offset")?;
            if !matches!(
                string(op, "field")?,
                "text" | "thinking" | "inputJson" | "result"
            ) {
                return Err("Invalid text field".into());
            }
            for key in ["blockId", "subagentToolId"] {
                if op.get(key).is_some() {
                    string(op, key)?;
                }
            }
        }
        "messages-remove" => {
            strings(op, "messageIds")?;
        }
        "turn-update" => {
            let turn = op.get("turn").ok_or("Missing turn")?;
            string(turn, "id")?;
            string(turn, "rootUserMessageId")?;
            string(turn, "startedAt")?;
            if !matches!(
                string(turn, "status")?,
                "running" | "complete" | "stopped" | "error" | "interrupted"
            ) {
                return Err("Invalid turn status".into());
            }
        }
        _ => return Err("Unknown transcript operation".into()),
    }
    Ok(())
}

fn require_message<'a>(projection: &'a mut Projection, op: &Value) -> Result<&'a mut Value> {
    projection
        .messages
        .get_mut(string(op, "messageId")?)
        .map(Arc::make_mut)
        .ok_or_else(|| "Unknown transcript message".into())
}
fn blocks(message: &mut Value) -> Result<&mut Vec<Value>> {
    message
        .get_mut("content")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Message has no blocks".into())
}
fn block<'a>(message: &'a mut Value, op: &Value) -> Result<&'a mut Value> {
    let id = string(op, "blockId")?;
    blocks(message)?
        .iter_mut()
        .find(|b| b.get("id").and_then(Value::as_str) == Some(id))
        .ok_or_else(|| "Unknown transcript block".into())
}
fn tool<'a>(block: &'a mut Value, op: &Value) -> Result<&'a mut Map<String, Value>> {
    let tool = block
        .get_mut("tool")
        .and_then(Value::as_object_mut)
        .ok_or("Block has no tool")?;
    if let Some(id) = op
        .get("subagentToolId")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        tool.get_mut("subagentCalls")
            .and_then(Value::as_array_mut)
            .ok_or("No nested calls")?
            .iter_mut()
            .find(|call| call.get("id").and_then(Value::as_str) == Some(id))
            .and_then(Value::as_object_mut)
            .ok_or_else(|| "Unknown nested tool".into())
    } else {
        Ok(tool)
    }
}

fn apply_operation(projection: &mut Projection, op: &Value) -> Result<()> {
    match string(op, "kind")? {
        "message-create" => {
            let message = &op["message"];
            let id = string(message, "id")?;
            if projection.messages.contains_key(id) {
                return Err("Duplicate transcript message".into());
            }
            projection.order.push(id.to_owned());
            projection
                .messages
                .insert(id.to_owned(), Arc::new(message.clone()));
        }
        "message-update" => {
            let message = require_message(projection, op)?
                .as_object_mut()
                .ok_or("Invalid message")?;
            message.extend(object(op, "details")?.clone());
            if op.get("clear").is_some() {
                for key in strings(op, "clear")? {
                    message.remove(&key);
                }
            }
        }
        "content-confirm" => {
            require_message(projection, op)?["content"] = op["content"].clone();
        }
        "block-upsert" => {
            let message = require_message(projection, op)?;
            if message["content"].as_str() == Some("") {
                message["content"] = Value::Array(Vec::new());
            }
            let content = blocks(message)?;
            let value = &op["block"];
            if let Some(old) = content.iter_mut().find(|b| b["id"] == value["id"]) {
                *old = value.clone();
            } else {
                content.push(value.clone());
            }
        }
        "blocks-remove" => {
            let removed = strings(op, "blockIds")?;
            blocks(require_message(projection, op)?)?
                .retain(|b| !removed.iter().any(|id| b["id"] == *id));
        }
        "block-update" => {
            let block = block(require_message(projection, op)?, op)?;
            let target = if string(op, "target")? == "block" {
                block.as_object_mut().ok_or("Invalid block")?
            } else {
                tool(block, op)?
            };
            target.extend(object(op, "details")?.clone());
        }
        "subagents-remove" => {
            let removed = strings(op, "toolIds")?;
            let parent = tool(block(require_message(projection, op)?, op)?, op)?;
            parent
                .get_mut("subagentCalls")
                .and_then(Value::as_array_mut)
                .ok_or("Nested removal has no calls")?
                .retain(|call| !removed.iter().any(|id| call["id"] == *id));
        }
        "subagent-upsert" => {
            let block = block(require_message(projection, op)?, op)?;
            let tool = block
                .get_mut("tool")
                .and_then(Value::as_object_mut)
                .ok_or("No parent tool")?;
            let calls = tool
                .entry("subagentCalls")
                .or_insert_with(|| Value::Array(Vec::new()));
            if !calls.is_array() {
                *calls = Value::Array(Vec::new());
            }
            let calls = calls.as_array_mut().ok_or("Invalid calls")?;
            let call = &op["call"];
            if let Some(old) = calls.iter_mut().find(|c| c["id"] == call["id"]) {
                *old = call.clone();
            } else {
                calls.push(call.clone());
            }
        }
        "text-append" => {
            let field = string(op, "field")?;
            let message = require_message(projection, op)?;
            let value = if op
                .get("blockId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .is_empty()
                && field == "text"
                && message["content"].is_string()
            {
                message.get_mut("content").ok_or("No content")?
            } else {
                let block = block(message, op)?;
                let container = if matches!(field, "text" | "thinking") {
                    block.as_object_mut().ok_or("Invalid block")?
                } else {
                    tool(block, op)?
                };
                container
                    .entry(field)
                    .or_insert_with(|| Value::String(String::new()))
            };
            let Value::String(text) = value else {
                return Err("Append target is not text".into());
            };
            if text.encode_utf16().count() as u64 != integer(op, "offset")? {
                return Err("Non-contiguous transcript text".into());
            }
            text.push_str(string(op, "text")?);
        }
        "messages-remove" => {
            let ids: HashSet<String> = strings(op, "messageIds")?.into_iter().collect();
            projection.messages.retain(|id, _| !ids.contains(id));
            projection.order.retain(|id| !ids.contains(id));
            projection.turns.retain(|_, turn| {
                !turn
                    .get("rootUserMessageId")
                    .and_then(Value::as_str)
                    .is_some_and(|id| ids.contains(id))
            });
        }
        "turn-update" => {
            let turn = &op["turn"];
            projection
                .turns
                .insert(string(turn, "id")?.to_owned(), Arc::new(turn.clone()));
        }
        _ => return Err("Unknown transcript operation".into()),
    }
    Ok(())
}

/// Undo only touched rows; a bad batch never leaks half its operations. Arc
/// snapshots avoid copying unrelated history or cloning a row per operation.
fn apply_batch(projection: &mut Projection, operations: &[Value]) -> Result<HashSet<String>> {
    let mut touched = HashSet::new();
    let mut turn_ids = HashSet::new();
    let mut removes = false;
    for op in operations {
        validate_operation(op)?;
        match string(op, "kind")? {
            "message-create" => {
                touched.insert(string(&op["message"], "id")?.to_owned());
            }
            "messages-remove" => {
                removes = true;
                let removed: HashSet<String> = strings(op, "messageIds")?.into_iter().collect();
                for (id, turn) in &projection.turns {
                    if turn
                        .get("rootUserMessageId")
                        .and_then(Value::as_str)
                        .is_some_and(|id| removed.contains(id))
                    {
                        turn_ids.insert(id.clone());
                    }
                }
                touched.extend(removed);
            }
            "turn-update" => {
                turn_ids.insert(string(&op["turn"], "id")?.to_owned());
            }
            _ => {
                touched.insert(string(op, "messageId")?.to_owned());
            }
        }
    }
    let before: Vec<_> = touched
        .iter()
        .map(|id| (id.clone(), projection.messages.get(id).cloned()))
        .collect();
    let turns: Vec<_> = turn_ids
        .iter()
        .map(|id| (id.clone(), projection.turns.get(id).cloned()))
        .collect();
    let previous_order = removes.then(|| projection.order.clone());
    let previous_len = projection.order.len();
    for op in operations {
        if let Err(error) = apply_operation(projection, op) {
            for (id, message) in before {
                match message {
                    Some(m) => {
                        projection.messages.insert(id, m);
                    }
                    None => {
                        projection.messages.remove(&id);
                    }
                }
            }
            for (id, turn) in turns {
                match turn {
                    Some(t) => {
                        projection.turns.insert(id, t);
                    }
                    None => {
                        projection.turns.remove(&id);
                    }
                }
            }
            if let Some(order) = previous_order {
                projection.order = order;
            } else {
                projection.order.truncate(previous_len);
            }
            return Err(error);
        }
    }
    Ok(touched)
}

impl Transcript {
    pub fn from_header(line: &str, session_id: &str) -> Result<Self> {
        let header: Value = serde_json::from_str(line).map_err(|e| e.to_string())?;
        if header["kind"] != "session-transcript"
            || header["version"].as_f64() != Some(2.0)
            || header["sessionId"] != session_id
            || string(&header, "generation")?.is_empty()
        {
            return Err("Invalid or unsupported transcript header".into());
        }
        let base_revision = integer(&header, "baseRevision")?;
        let baseline = header["baseline"]
            .as_bool()
            .ok_or("Invalid baseline header")?;
        Ok(Self {
            generation: string(&header, "generation")?.into(),
            revision: base_revision,
            base_revision,
            last_batch_id: None,
            valid_bytes: line.len() as u64 + 1,
            tail: Tail::Clean,
            projection: Projection::default(),
            baseline_complete: !baseline,
            header_line: line.into(),
            last_line_start: 0,
            last_line: line.into(),
        })
    }

    fn apply_line(&mut self, line: &str) -> Result<HashSet<String>> {
        if line.len() as u64 > MAX_LINE_BYTES {
            return Err("Transcript line exceeds limit".into());
        }
        let (body, suffix) = line
            .strip_prefix("{\"batch\":")
            .and_then(|s| s.rsplit_once(",\"checksum\":\""))
            .ok_or("Invalid batch envelope")?;
        let expected = suffix.strip_suffix("\"}").ok_or("Invalid checksum")?;
        if expected != format!("{:x}", Sha256::digest(body.as_bytes())) {
            return Err("Invalid batch checksum".into());
        }
        let batch: Value = serde_json::from_str(body).map_err(|e| e.to_string())?;
        let id = string(&batch, "id")?;
        let revision = integer(&batch, "revision")?;
        let from = integer(&batch, "fromRevision")?;
        match string(&batch, "mode")? {
            "baseline"
                if !self.baseline_complete && revision == self.base_revision && from == 0 => {}
            "delta" if self.baseline_complete && from == self.revision + 1 && revision >= from => {}
            _ => return Err("Non-contiguous transcript revision".into()),
        }
        let touched = apply_batch(&mut self.projection, array(&batch, "operations")?)?;
        if batch["mode"] == "baseline" && batch.get("baselineEnd").is_some_and(json_truthy) {
            self.baseline_complete = true;
        }
        self.revision = revision;
        self.last_batch_id = Some(id.into());
        self.last_line_start = self.valid_bytes;
        self.valid_bytes += line.len() as u64 + 1;
        self.last_line = line.into();
        Ok(touched)
    }

    fn read_tail(&mut self, reader: &mut impl BufRead) -> Result<HashSet<String>> {
        self.tail = Tail::Clean;
        let mut touched = HashSet::new();
        loop {
            match read_line(reader)? {
                Line::Complete(line) => match self.apply_line(&line) {
                    Ok(ids) => touched.extend(ids),
                    Err(_) => {
                        self.tail = Tail::Invalid;
                        break;
                    }
                },
                Line::End => break,
                Line::Incomplete => {
                    self.tail = Tail::Incomplete;
                    break;
                }
                Line::Invalid => {
                    self.tail = Tail::Invalid;
                    break;
                }
            }
        }
        if !self.baseline_complete {
            return Err("Incomplete transcript baseline".into());
        }
        Ok(touched)
    }

    /// Return None when the cached prefix no longer belongs to this file. The
    /// caller must discard the derived projection and perform a cold fold.
    pub fn extend_file(&mut self, file: &mut File) -> Result<Option<HashSet<String>>> {
        if file.metadata().map_err(|e| e.to_string())?.len() < self.valid_bytes {
            return Ok(None);
        }
        file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        let mut reader = BufReader::new(&mut *file);
        if !matches!(read_line(&mut reader)?, Line::Complete(ref line) if line == &self.header_line)
        {
            return Ok(None);
        }
        reader
            .seek(SeekFrom::Start(self.last_line_start))
            .map_err(|e| e.to_string())?;
        if !matches!(read_line(&mut reader)?, Line::Complete(ref line) if line == &self.last_line) {
            return Ok(None);
        }
        reader
            .seek(SeekFrom::Start(self.valid_bytes))
            .map_err(|e| e.to_string())?;
        self.read_tail(&mut reader).map(Some)
    }
}

fn json_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(v) => *v,
        Value::String(s) => !s.is_empty(),
        Value::Number(n) => n.as_f64() != Some(0.0),
        _ => true,
    }
}
enum Line {
    Complete(String),
    End,
    Incomplete,
    Invalid,
}
fn read_line(reader: &mut impl BufRead) -> Result<Line> {
    let mut bytes = Vec::new();
    // A corrupt file without a newline cannot allocate unbounded memory.
    reader
        .take(MAX_LINE_BYTES + 2)
        .read_until(b'\n', &mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Ok(Line::End);
    }
    if bytes.last() != Some(&b'\n') {
        return Ok(if bytes.len() as u64 > MAX_LINE_BYTES {
            Line::Invalid
        } else {
            Line::Incomplete
        });
    }
    bytes.pop();
    if bytes.len() as u64 > MAX_LINE_BYTES {
        return Ok(Line::Invalid);
    }
    Ok(match String::from_utf8(bytes) {
        Ok(line) => Line::Complete(line),
        Err(_) => Line::Invalid,
    })
}

pub fn read_transcript(reader: impl Read, session_id: &str) -> Result<Transcript> {
    let mut reader = BufReader::new(reader);
    let Line::Complete(line) = read_line(&mut reader)? else {
        return Err("Incomplete transcript header".into());
    };
    let mut transcript = Transcript::from_header(&line, session_id)?;
    transcript.read_tail(&mut reader)?;
    Ok(transcript)
}

pub fn read_file(path: &Path, session_id: &str) -> Result<Transcript> {
    read_transcript(
        File::open(path).map_err(|e| format!("Open product transcript: {e}"))?,
        session_id,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    pub(crate) fn fixtures() -> Value {
        serde_json::from_str(include_str!(
            "../../src/shared/fixtures/session-transcript-v2.json"
        ))
        .unwrap()
    }

    #[test]
    #[ignore = "Run against synthetic files from scripts/benchmark-session-transcript.mjs --keep-fixtures"]
    fn benchmark_cold_fold() {
        let root = std::env::var("MYAGENTS_TRANSCRIPT_BENCH_DIR")
            .expect("synthetic fixture directory required");
        for mib in [10, 100] {
            let id = format!("cold{mib}");
            let path = Path::new(&root).join(format!("{id}.jsonl"));
            let mut samples = Vec::new();
            for _ in 0..5 {
                let start = std::time::Instant::now();
                let transcript = read_file(&path, &id).unwrap();
                assert_eq!(transcript.projection.order.len(), mib);
                assert_eq!(transcript.tail, Tail::Clean);
                samples.push(start.elapsed().as_millis());
            }
            eprintln!("V2 Rust cold {mib} MiB: samples_ms={samples:?}");
        }
    }

    #[test]
    fn node_rust_wire_parity() {
        for case in fixtures()["cases"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let result =
                read_transcript(case["wire"].as_str().unwrap().as_bytes(), "fixture-session");
            if case["error"] == true {
                assert!(result.is_err(), "{name}");
                continue;
            }
            let result = result.unwrap_or_else(|e| panic!("{name}: {e}"));
            let messages: Vec<&Value> = result
                .projection
                .order
                .iter()
                .map(|id| &*result.projection.messages[id])
                .collect();
            let turns: Vec<&Value> = result.projection.turns.values().map(|t| &**t).collect();
            let actual = json!({"messages":messages, "turns":turns, "revision":result.revision,
                "lastBatchId":result.last_batch_id,"validBytes":result.valid_bytes,
                "tail":match result.tail { Tail::Clean=>"clean", Tail::Incomplete=>"incomplete",Tail::Invalid=>"invalid" }});
            assert_eq!(actual, case["expected"], "{name}");
        }
    }

    #[test]
    fn node_rust_format_parity() {
        for case in fixtures()["formats"].as_array().unwrap() {
            let result = resolve_format(
                case.get("metadata"),
                case["legacyFileExists"].as_bool().unwrap(),
                case["v2FileExists"].as_bool().unwrap(),
            );
            assert_eq!(
                format!("{result:?}").to_lowercase(),
                case["expected"].as_str().unwrap(),
                "{case}"
            );
        }
    }

    #[test]
    fn cursor_checks_generation_and_last_committed_batch_before_tail() {
        let cases = fixtures();
        let find = |name| {
            cases["cases"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["name"] == name)
                .unwrap()["wire"]
                .as_str()
                .unwrap()
        };
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("fixture-session.jsonl");
        std::fs::write(&path, find("interrupted-open-turn")).unwrap();
        let mut transcript = read_file(&path, "fixture-session").unwrap();
        std::fs::write(&path, find("utf16-offset")).unwrap();
        let changed = transcript
            .extend_file(&mut File::open(&path).unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(changed, HashSet::from(["a1".into()]));
        assert_eq!(transcript.revision, 4);
        // Same-size replacement also invalidates the generation-bound cursor.
        std::fs::write(&path, find("utf16-offset").replace("\"g1\"", "\"g2\"")).unwrap();
        assert!(transcript
            .extend_file(&mut File::open(&path).unwrap())
            .unwrap()
            .is_none());
        // Retaining the header while replacing an accepted batch also fails.
        std::fs::write(&path, find("utf16-offset").replace("\"b2\"", "\"xx\"")).unwrap();
        assert!(transcript
            .extend_file(&mut File::open(&path).unwrap())
            .unwrap()
            .is_none());
    }
}
