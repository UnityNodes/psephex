use crate::Case;

/// Three fields of 500 bytes, four account ids of up to 64 bytes and the fixed wording stay under
/// the oracle's 2000-byte question limit, so a case that opens can always be asked.
pub const MAX_FIELD_BYTES: usize = 500;

const NO_RESPONSE: &str = "No response within the response window.";

/// The court writes the question itself from both sides' text, so neither party can phrase the
/// verdict: the claimant only states a claim and evidence, and the counterparty's answer is put
/// next to it word for word.
pub fn oracle_question(case: &Case) -> String {
    format!(
        "Claim by {claimant}: {claim}\nEvidence from {claimant}: {evidence}\nResponse from {counterparty}: {response}\nBased only on the evidence above, is the claim true?",
        claimant = case.claimant,
        counterparty = case.counterparty,
        claim = case.claim,
        evidence = case.evidence,
        response = case.response.as_deref().unwrap_or(NO_RESPONSE),
    )
}
