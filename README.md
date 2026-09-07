# TwinCharter

**One charter in. Two accountable lanes out.**

TwinCharter is a GenLayer project built around the frozen `ResponsibilitySplit` Intelligent Contract. It lets one current responsible party propose a fixed two-way handoff while requiring the union of both child charters to preserve every material duty in the immutable parent charter.

## Deployments

- Clean Project contract: `0x7827A4a5dAC1414622944f328962A7E2Ef82a341`
- Runtime evidence contract: `0xf1E7D355FBB76b8077879022510D66Ce5782D909`
- Frozen contract SHA256: `f89e31328942900ff2d98c93e8835e55e45280f639d19eb9f77dacc33dfc32fc`
- Contract version: `1.1`

## Product flow

1. Create a workspace with an immutable parent charter.
2. Propose exactly two successors and two child charters.
3. GenLayer validators answer one narrow question: does the union of both child charters preserve the parent scope?
4. `SPLIT_HAS_GAP` is recoverable and leaves the parent active.
5. `SPLIT_COVERS_PARENT` enters dual acceptance.
6. Responsibility transfers only after both proposed successors accept.

Overlap between child charters is allowed. The semantic model does not choose successors, determine fairness, or decide real-world performance.

## Frontend evidence policy

The frontend reads `finalized` contract state. A write is never treated as successful merely because a transaction reached `FINALIZED`: the app checks any available execution result and then verifies an action-specific durable postcondition from finalized state.

## Local verification

```bash
npm install
npm run verify
npm run build
```

`npm run verify` checks the frozen contract hash, address configuration, and public-package hygiene.

See `TESTING.md` for the runtime evidence behind the frozen contract.
