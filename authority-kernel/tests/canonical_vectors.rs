//! SYLPH FUSION — CROSS-LANGUAGE CANONICAL VECTOR TEST
//! Specifications: Blueprint Section 12 (Golden Vector Test in Rust)

use authority_kernel::canonical::{encode_canonical_json_value, hash_canonical_json_value};
use serde::Deserialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
struct GoldenVector {
    name: String,
    #[serde(rename = "rawJson")]
    raw_json: String,
    #[serde(rename = "encodedHex")]
    encoded_hex: String,
    sha256: String,
}

#[test]
fn test_canonical_golden_vectors_parity() {
    let path = Path::new("../test/fixtures/canonical-golden-v1.json");
    let content = fs::read_to_string(path).expect("Failed to read canonical-golden-v1.json");
    let vectors: Vec<GoldenVector> = serde_json::from_str(&content).expect("Failed to parse golden vectors");

    assert!(!vectors.is_empty(), "Golden vectors must not be empty");

    for v in vectors {
        let value: serde_json::Value = serde_json::from_str(&v.raw_json).expect("Failed to parse vector value");
        let encoded_bytes = encode_canonical_json_value(&value);
        let encoded_hex = hex::encode(&encoded_bytes);
        let hash = hash_canonical_json_value(&value);

        assert_eq!(
            encoded_hex, v.encoded_hex,
            "Encoded bytes mismatch for vector '{}'",
            v.name
        );
        assert_eq!(
            hash, v.sha256,
            "SHA256 mismatch for vector '{}'",
            v.name
        );
    }
}
