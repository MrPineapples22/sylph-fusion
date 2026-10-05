//! SYLPH FUSION — CANONICAL ENCODING V1 IN RUST
//! Specifications: Blueprint Section 12 (Cross-Language Canonical Encoding)
//!
//! Provides bit-exact, locale-independent, binary encoding
//! between TypeScript and Rust for all canonical hash roots and proof verification.

use serde_json::Value;
use sha2::{Digest, Sha256};

pub const TYPE_TAG_NULL: u8 = 0x00;
pub const TYPE_TAG_BOOL_FALSE: u8 = 0x01;
pub const TYPE_TAG_BOOL_TRUE: u8 = 0x02;
pub const TYPE_TAG_U64: u8 = 0x03;
pub const TYPE_TAG_I64: u8 = 0x04;
pub const TYPE_TAG_STRING_UTF8: u8 = 0x06;
pub const TYPE_TAG_ARRAY: u8 = 0x08;
pub const TYPE_TAG_MAP: u8 = 0x09;

pub fn encode_canonical_json_value(value: &Value) -> Vec<u8> {
    match value {
        Value::Null => vec![TYPE_TAG_NULL],
        Value::Bool(false) => vec![TYPE_TAG_BOOL_FALSE],
        Value::Bool(true) => vec![TYPE_TAG_BOOL_TRUE],
        Value::Number(num) => {
            if let Some(u) = num.as_u64() {
                let mut buf = Vec::with_capacity(9);
                buf.push(TYPE_TAG_U64);
                buf.extend_from_slice(&u.to_be_bytes());
                buf
            } else if let Some(i) = num.as_i64() {
                let mut buf = Vec::with_capacity(9);
                buf.push(TYPE_TAG_I64);
                buf.extend_from_slice(&i.to_be_bytes());
                buf
            } else if let Some(f) = num.as_f64() {
                let mut buf = Vec::with_capacity(9);
                buf.push(0x0b);
                buf.extend_from_slice(&f.to_be_bytes());
                buf
            } else {
                vec![TYPE_TAG_NULL]
            }
        }
        Value::String(s) => {
            let bytes = s.as_bytes();
            let mut buf = Vec::with_capacity(5 + bytes.len());
            buf.push(TYPE_TAG_STRING_UTF8);
            buf.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
            buf.extend_from_slice(bytes);
            buf
        }
        Value::Array(arr) => {
            let encoded_items: Vec<Vec<u8>> = arr.iter().map(encode_canonical_json_value).collect();
            let mut buf = Vec::with_capacity(5 + encoded_items.iter().map(|i| i.len()).sum::<usize>());
            buf.push(TYPE_TAG_ARRAY);
            buf.extend_from_slice(&(encoded_items.len() as u32).to_be_bytes());
            for item in encoded_items {
                buf.extend_from_slice(&item);
            }
            buf
        }
        Value::Object(map) => {
            let mut entries: Vec<(Vec<u8>, Vec<u8>)> = map
                .iter()
                .map(|(k, v)| {
                    let k_val = Value::String(k.clone());
                    (encode_canonical_json_value(&k_val), encode_canonical_json_value(v))
                })
                .collect();

            // Strict byte comparison sorting of encoded keys
            entries.sort_by(|a, b| a.0.cmp(&b.0));

            let mut buf = Vec::new();
            buf.push(TYPE_TAG_MAP);
            buf.extend_from_slice(&(entries.len() as u32).to_be_bytes());
            for (k_buf, v_buf) in entries {
                buf.extend_from_slice(&k_buf);
                buf.extend_from_slice(&v_buf);
            }
            buf
        }
    }
}

pub fn hash_canonical_json_value(value: &Value) -> String {
    let bytes = encode_canonical_json_value(value);
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    hex::encode(hasher.finalize())
}
