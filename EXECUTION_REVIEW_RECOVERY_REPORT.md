# Execution Review Recovery Report

Current state: **NOT_IMPLEMENTED for a real live transaction**.

The required review artifact must bind the exact decoded transaction bytes, message hash, intent, signer, fee payer, programs, writable accounts, amounts, mint/destination, compute/priority fee, simulation, policy, review expiry and frozen identity. The current new signing-firewall contract rejects if that decoded view is incomplete or mismatched.

Evidence level: L0; unit policy behavior only.

