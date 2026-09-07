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

## Local R2 gates

The exact R2 candidate passed the local pre-deploy gates used for this project: Python compile, AST/policy checks, prompt-fence regression, contract regression suite, cross-workspace cache isolation checks, semantic evaluation cap checks, malformed/provider/non-convergence no-write checks, bounds/pagination checks, and public package hygiene.

No claim is made for tools that were not actually run against this exact source.
