use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use super::types::{Error, Result};

/// Preserve user names/removals, while refreshing native capability metadata.
pub(super) fn merge_configured(
    existing: &[Value],
    catalog: &[Value],
    removed: &[Value],
) -> Vec<Value> {
    let mut merged = existing.to_vec();
    for model in catalog {
        let id = &model["model"];
        if let Some(row) = merged.iter_mut().find(|row| &row["model"] == id) {
            if row["source"] == "discovered" {
                for field in [
                    "contextLength",
                    "maxOutputTokens",
                    "inputModalities",
                    "outputModalities",
                    "supportedProtocols",
                ] {
                    if let Some(value) = model.get(field) {
                        row[field] = value.clone();
                    } else if let Some(object) = row.as_object_mut() {
                        object.remove(field);
                    }
                }
            }
        } else if !removed.contains(id) {
            merged.push(model.clone());
        }
    }
    merged
}

/// IDs come only from the running native component. Account and routed views
/// can update at different times; metadata absence must never hide a model.
pub(super) fn project(
    registered: &[Value],
    routed: &[String],
    definitions: &[Value],
) -> Result<Vec<Value>> {
    let definitions: BTreeMap<_, _> = definitions
        .iter()
        .filter_map(|item| Some((item.get("id")?.as_str()?, item)))
        .collect();
    let mut ids = BTreeSet::new();
    let mut models = Vec::new();
    for item in registered
        .iter()
        .cloned()
        .chain(routed.iter().map(|id| json!({"id":id})))
    {
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or_else(Error::contract)?;
        if !ids.insert(id.to_owned()) {
            continue;
        }
        let definition = definitions.get(id).copied().unwrap_or(&item);
        let mut model = json!({"model":id, "modelName":definition.get("display_name")
            .or_else(|| item.get("display_name")).and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or(id),
            "modelSeries":id, "source":"discovered", "supportedProtocols":["anthropic:messages"]});
        for (native, field) in [
            ("context_length", "contextLength"),
            ("max_completion_tokens", "maxOutputTokens"),
        ] {
            if let Some(value) = definition
                .get(native)
                .and_then(Value::as_u64)
                .filter(|n| *n > 0)
            {
                model[field] = json!(value);
            }
        }
        for (native, field) in [
            ("supportedInputModalities", "inputModalities"),
            ("supportedOutputModalities", "outputModalities"),
        ] {
            if let Some(values) = definition.get(native).and_then(Value::as_array) {
                model[field] = json!(values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_ascii_lowercase)
                    .collect::<Vec<_>>());
            }
        }
        if let Some(thinking) = definition.get("thinking") {
            model["thinking"] = json!(!thinking.is_null());
        }
        models.push(model);
    }
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_new_models_and_metadata_need_no_host_approval() {
        let projected = project(
            &[
                json!({"id":"gemini-3.8-flash-high"}),
                json!({"id":"future-model"}),
            ],
            &["gemini-3.8-flash-high".to_owned(), "route-only".to_owned()],
            &[
                json!({"id":"gemini-3.8-flash-high", "context_length":1048576,
                "supportedInputModalities":["text","image","audio"], "thinking":{"min":1}}),
            ],
        )
        .unwrap();
        assert_eq!(projected.len(), 3);
        let gemini = projected
            .iter()
            .find(|m| m["model"] == "gemini-3.8-flash-high")
            .unwrap();
        assert_eq!(gemini["contextLength"], 1048576);
        assert_eq!(gemini["inputModalities"], json!(["text", "image", "audio"]));
        assert!(projected.iter().any(|m| m["model"] == "future-model"));
    }
    #[test]
    fn catalog_merge_preserves_configured_overrides_and_temporarily_absent_models() {
        let saved = vec![
            json!({"model":"a", "modelName":"My name", "contextLength":1234, "source":"discovered"}),
            json!({"model":"temporarily-absent", "modelName":"Keep me", "source":"discovered"}),
        ];
        let catalog = vec![
            json!({"model":"a", "modelName":"Native name", "contextLength":9999}),
            json!({"model":"new"}),
        ];
        let merged = merge_configured(&saved, &catalog, &[]);
        assert_eq!(merged[0]["modelName"], saved[0]["modelName"]);
        assert_eq!(merged[0]["contextLength"], 9999);
        assert_eq!(merged[1], saved[1]);
        assert_eq!(merged[2]["model"], "new");
        let without_new = merge_configured(&saved, &catalog, &[json!("new")]);
        assert_eq!(without_new.len(), saved.len());
        assert_eq!(without_new[0]["modelName"], "My name");
    }
}
