//! Chinese + English tokenizer configuration using jieba-rs.

use tantivy::tokenizer::{LowerCaser, RemoveLongFilter, TextAnalyzer};
use tantivy_jieba::JiebaTokenizer;

/// Name used to register the tokenizer with Tantivy indices.
pub const TOKENIZER_NAME: &str = "chinese";

/// Build a TextAnalyzer that handles Chinese (jieba segmentation) and English
/// (whitespace split + lowercasing). Tokens longer than 40 bytes are removed.
pub fn build_chinese_tokenizer() -> TextAnalyzer {
    TextAnalyzer::builder(JiebaTokenizer {})
        .filter(RemoveLongFilter::limit(40))
        .filter(LowerCaser)
        .build()
}
