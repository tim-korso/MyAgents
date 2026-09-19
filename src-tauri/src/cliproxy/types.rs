use serde::{Deserialize, Serialize};

pub(super) type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Error {
    pub code: String,
    pub message: String,
}
impl Error {
    pub(super) fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
        }
    }
    pub(super) fn contract() -> Self {
        Self::new("component_contract", "组件接口返回了不受支持的结果")
    }
    pub(super) fn storage() -> Self {
        Self::new("storage", "无法保存组件状态，请检查本机存储权限与空间")
    }
    pub(super) fn cancelled() -> Self {
        Self::new("cancelled", "操作已取消")
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for Error {}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub provider_id: String,
    pub base_url: String,
    pub api_key: String,
    pub instance_generation: String,
    pub account_generation: String,
    pub lease_id: String,
    pub model_policy: ModelPolicy,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPolicy {
    pub id: String,
    pub thinking: Option<bool>,
    pub context_length: Option<u64>,
    pub max_output_tokens: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BindingRequest {
    pub sidecar_id: String,
    pub operation_id: String,
    pub model: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LeaseRequest {
    pub sidecar_id: String,
    pub operation_id: String,
    pub lease_id: Option<String>,
    pub terminal: Option<TerminalOutcome>,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TerminalOutcome {
    Succeeded,
    Failed,
}
