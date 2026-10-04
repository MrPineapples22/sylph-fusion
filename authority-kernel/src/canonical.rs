//! SYLPH FUSION — CANONICAL ENCODING
//! Specifications: Master Blueprint Section XXXIV, Phase 1

use serde::Serialize;

pub fn canonical_json<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    serde_json::to_string(value)
}
