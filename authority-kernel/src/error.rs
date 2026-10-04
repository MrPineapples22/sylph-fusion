//! SYLPH FUSION — AUTHORITY KERNEL ERROR TAXONOMY
//! Specifications: Master Blueprint Section XXXVII

use thiserror::Error;

#[derive(Error, Debug)]
pub enum KernelError {
    #[error("Action authorization denied: {0:?}")]
    AuthorizationDenied(Vec<crate::transition::KernelDenialReason>),

    #[error("Cryptographic verification failure: {0}")]
    CryptoError(String),

    #[error("Serialization failure: {0}")]
    SerializationError(String),
}
