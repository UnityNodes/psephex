use crate::{emit, Court, CourtExt};
use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId, Gas, NearToken, Promise, PromiseError};
use serde_json::json;

const PAID_GAS: Gas = Gas::from_tgas(10);

/// A transfer to an account that does not exist, or was deleted, comes back to the court and
/// would sit there forever once the code is locked. Each payout therefore names a fallback, the
/// other party, that receives the amount when the first transfer fails.
pub(crate) fn pay(to: &AccountId, amount: u128, fallback: &AccountId, case_id: u64) {
    if amount == 0 {
        return;
    }
    Promise::new(to.clone())
        .transfer(NearToken::from_yoctonear(amount))
        .then(
            Court::ext(env::current_account_id())
                .with_static_gas(PAID_GAS)
                .on_paid(case_id, to.clone(), fallback.clone(), U128(amount)),
        )
        .detach();
}

#[near]
impl Court {
    /// A transfer returns no value, so its result is read raw instead of being deserialized:
    /// only a failed receipt counts as a failed payout.
    #[private]
    pub fn on_paid(
        &mut self,
        case_id: u64,
        to: AccountId,
        fallback: AccountId,
        amount: U128,
    ) -> bool {
        if !matches!(env::promise_result_checked(0, 0), Err(PromiseError::Failed)) {
            return true;
        }
        emit(
            "payout_failed",
            json!({ "case_id": case_id, "to": to, "fallback": fallback, "amount": amount }),
        );
        if fallback != to {
            Promise::new(fallback)
                .transfer(NearToken::from_yoctonear(amount.0))
                .detach();
        }
        false
    }
}
