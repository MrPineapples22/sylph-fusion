//! SYLPH FUSION — CANONICAL EVIDENCE CLASS IN RUST
//! Specifications: Blueprint Section 4 & 14

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EvidenceClass {
    VerifiedChain,
    VerifiedExecution,
    ObservedExternal,
    DerivedCertified,
    HistoricalCertified,
    PaperSimulated,
    ModelledCounterfactual,
    OperatorAsserted,
    Unknown,
    Missing,
    Conflicted,
    Stale,
    Revoked,
    Invalid,
}

impl EvidenceClass {
    pub fn is_executable_authority(&self) -> bool {
        matches!(self, Self::VerifiedChain | Self::VerifiedExecution)
    }

    pub fn is_failing_or_degraded(&self) -> bool {
        matches!(
            self,
            Self::Unknown
                | Self::Missing
                | Self::Conflicted
                | Self::Stale
                | Self::Revoked
                | Self::Invalid
        )
    }
}
