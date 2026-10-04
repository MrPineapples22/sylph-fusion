//! SYLPH FUSION — CRYPTOGRAPHIC UTILITIES
//! Specifications: Master Blueprint Section XXXVII

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

pub fn hmac_sha256_hex(key: &[u8], data: &[u8]) -> Result<String, &'static str> {
    let mut mac = HmacSha256::new_from_slice(key).map_err(|_| "INVALID_KEY_LENGTH")?;
    mac.update(data);
    Ok(format!("{:x}", mac.finalize().into_bytes()))
}
