# TwinCharter / ResponsibilitySplit — Testing

## Exact contract

- Source: `contracts/TwinCharter.py`
- SHA256: `f89e31328942900ff2d98c93e8835e55e45280f639d19eb9f77dacc33dfc32fc`
- Runtime evidence address: `0xf1E7D355FBB76b8077879022510D66Ce5782D909`
- Clean Project address: `0x7827A4a5dAC1414622944f328962A7E2Ef82a341`

## Recorded finalized runtime gates

### GAP consequence — PASS
A split omitting the weekly operations report produced `SPLIT_HAS_GAP`, incremented `gap_attempts`, and left the parent active.

### Same-workspace retry / no reroll — PASS
The exact GAP split was submitted again in Workspace #1. The second split reported `used_cache=true`; `semantic_eval_count` stayed at `1`.

### Full coverage with overlap — PASS
A proposal with overlapping backup duties across A and B preserved the full parent charter and produced `SPLIT_COVERS_PARENT`, entering `PENDING_DUAL_ACCEPTANCE`.

### Partial acceptance safety — PASS
Successor A accepted while successor B had not. The parent remained `ACTIVE`, epoch remained `0`, and no child responsibilities were created.

### Dual acceptance transfer — PASS
After successor B accepted the same split, finalized state showed:

- split status `ACTIVATED`;
- parent status `CLOSED`;
- current responsible = zero address;
- epoch `1`;
- exactly `2` active child responsibilities;
- child #1 and child #2 bound to their proposed successor, charter, source split, and epoch.

### Cross-workspace cache isolation — PASS
Workspace #2 used the same parent charter and exact GAP candidate already classified in Workspace #1. Its first split reported `used_cache=false` and `semantic_eval_count=1`, demonstrating workspace-scoped cache isolation.

## Tracked behavioral verifier

The repository now includes `tests/test_twincharter_behavior.py`, executed automatically by `npm run verify`. The tests load the exact frozen `contracts/TwinCharter.py` source under a minimal deterministic GenLayer runtime stub and exercise the contract methods directly. The harness controls sender identity and nondeterministic validator responses while leaving the production contract bytes unchanged.

Tracked state-machine gates include:

- authorization: outsider propose/accept/withdraw attempts fail before consequential state changes;
- nondeterministic provider failure: semantic failure leaves split state, counters, and cache unchanged;
- malformed semantic output: fail-closed with no split/cache write;
- validator disagreement/non-convergence: no consequential state or cache write;
- same-workspace cache/no-reroll: exact GAP retry uses cache, does not call nondeterminism again, and does not increment `semantic_eval_count`;
- A/B input-order normalization: swapping the same successor+charter assignments hits the same cache entry;
- cross-workspace isolation: an identical candidate in another workspace requires a fresh semantic evaluation;
- partial acceptance: one successor acceptance leaves the parent `ACTIVE`, epoch `0`, and creates zero children;
- final activation: second successor acceptance closes the parent, increments epoch once, creates exactly two correctly bound children, and blocks terminal replay/bypass paths;
- withdrawal: a pending covering split can be withdrawn only by the current responsible party without moving responsibility.

These executable local tests complement the recorded finalized StudioNet evidence above. They do not claim to replace network-level consensus/runtime evidence.

## Verification scope

`npm run verify` is the repository-tracked local gate for this submission. It verifies source parity and address configuration, runs the executable state-machine tests above, and performs public-package hygiene checks. The recorded StudioNet gates remain network evidence; the local stub suite is complementary and is not presented as a substitute for live GenLayer consensus execution.
