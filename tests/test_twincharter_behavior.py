from __future__ import annotations

from pathlib import Path
import unittest

from genlayer_stub import Address, UserError, fresh_contract, gl, load_contract, queue_verdict, set_sender


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "contracts" / "TwinCharter.py"

OWNER = "0x1111111111111111111111111111111111111111"
SUCCESSOR_A = "0x2222222222222222222222222222222222222222"
SUCCESSOR_B = "0x3333333333333333333333333333333333333333"
OUTSIDER = "0x4444444444444444444444444444444444444444"

PARENT = (
    "Maintain monitoring, respond to critical alerts, verify backups, "
    "and publish the weekly operations report."
)
GAP_A = "Maintain monitoring and respond to critical alerts."
GAP_B = "Verify backups."
COVER_A = "Maintain monitoring, respond to critical alerts, and verify backups."
COVER_B = "Verify backups and publish the weekly operations report."


class TwinCharterBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_contract(CONTRACT_PATH)

    def setUp(self):
        gl.nondet.reset()
        self.contract = fresh_contract(self.mod)
        set_sender(OWNER)
        self.contract.create_workspace(PARENT)

    def snapshot_workspace(self, workspace_id: int = 1):
        return self.contract.get_workspace(workspace_id)

    def propose_covering_split(self):
        queue_verdict(self.mod.SPLIT_COVERS_PARENT)
        set_sender(OWNER)
        self.contract.propose_split(1, SUCCESSOR_A, COVER_A, SUCCESSOR_B, COVER_B)
        return self.contract.get_split(1, 1)

    def test_authorization_blocks_unauthorized_propose_accept_and_withdraw(self):
        before = self.snapshot_workspace()
        set_sender(OUTSIDER)
        with self.assertRaisesRegex(UserError, "Only the current responsible party"):
            self.contract.propose_split(1, SUCCESSOR_A, COVER_A, SUCCESSOR_B, COVER_B)
        self.assertEqual(self.snapshot_workspace(), before)
        self.assertEqual(gl.nondet.calls, 0, "authorization must fail before semantic evaluation")

        self.propose_covering_split()
        set_sender(OUTSIDER)
        with self.assertRaisesRegex(UserError, "Only a proposed successor"):
            self.contract.accept_split(1, 1)
        split = self.contract.get_split(1, 1)
        self.assertFalse(split["accepted_a"])
        self.assertFalse(split["accepted_b"])

        with self.assertRaisesRegex(UserError, "Only the current responsible party"):
            self.contract.withdraw_split(1, 1)
        self.assertEqual(self.contract.get_split(1, 1)["status"], self.mod.SPLIT_PENDING)

    def test_nondeterministic_provider_failure_is_fail_closed_and_no_write(self):
        before = self.snapshot_workspace()
        cache_before = dict(self.contract.verdict_cache)
        gl.nondet.queue(RuntimeError("provider unavailable"), RuntimeError("provider unavailable"))
        set_sender(OWNER)
        with self.assertRaisesRegex(UserError, "Semantic evaluation failed"):
            self.contract.propose_split(1, SUCCESSOR_A, COVER_A, SUCCESSOR_B, COVER_B)
        self.assertEqual(self.snapshot_workspace(), before)
        self.assertEqual(dict(self.contract.verdict_cache), cache_before)
        self.assertEqual(len(self.contract.splits), 0)

    def test_nondeterministic_malformed_output_is_fail_closed_and_no_write(self):
        before = self.snapshot_workspace()
        gl.nondet.queue({"wrong": "shape"}, {"wrong": "shape"})
        with self.assertRaisesRegex(UserError, "Semantic evaluation failed"):
            self.contract.propose_split(1, SUCCESSOR_A, COVER_A, SUCCESSOR_B, COVER_B)
        self.assertEqual(self.snapshot_workspace(), before)
        self.assertEqual(len(self.contract.verdict_cache), 0)
        self.assertEqual(len(self.contract.splits), 0)

    def test_nondeterministic_disagreement_does_not_write_state_or_cache(self):
        before = self.snapshot_workspace()
        gl.nondet.queue(
            {"verdict": self.mod.SPLIT_COVERS_PARENT},
            {"verdict": self.mod.SPLIT_HAS_GAP},
        )
        with self.assertRaisesRegex(UserError, "did not converge"):
            self.contract.propose_split(1, SUCCESSOR_A, COVER_A, SUCCESSOR_B, COVER_B)
        self.assertEqual(self.snapshot_workspace(), before)
        self.assertEqual(len(self.contract.verdict_cache), 0)
        self.assertEqual(len(self.contract.splits), 0)

    def test_gap_retry_uses_workspace_cache_without_reroll(self):
        queue_verdict(self.mod.SPLIT_HAS_GAP)
        self.contract.propose_split(1, SUCCESSOR_A, GAP_A, SUCCESSOR_B, GAP_B)
        first = self.contract.get_split(1, 1)
        after_first = self.snapshot_workspace()
        calls_after_first = gl.nondet.calls

        self.assertEqual(first["status"], self.mod.SPLIT_GAP)
        self.assertFalse(first["used_cache"])
        self.assertEqual(after_first["semantic_eval_count"], 1)
        self.assertEqual(after_first["gap_attempts"], 1)
        self.assertEqual(after_first["active_split_id"], 0)

        # No responses are queued: a reroll would therefore fail this test.
        self.contract.propose_split(1, SUCCESSOR_A, GAP_A, SUCCESSOR_B, GAP_B)
        second = self.contract.get_split(1, 2)
        after_second = self.snapshot_workspace()
        self.assertTrue(second["used_cache"])
        self.assertEqual(after_second["semantic_eval_count"], 1)
        self.assertEqual(after_second["gap_attempts"], 2)
        self.assertEqual(gl.nondet.calls, calls_after_first)

    def test_cache_normalizes_ab_input_order_for_same_address_charter_assignment(self):
        queue_verdict(self.mod.SPLIT_HAS_GAP)
        self.contract.propose_split(1, SUCCESSOR_A, GAP_A, SUCCESSOR_B, GAP_B)
        calls_after_first = gl.nondet.calls

        # Swap both successor+charter pairs. This is the same assignment and
        # must hit the normalized cache rather than consume another semantic run.
        self.contract.propose_split(1, SUCCESSOR_B, GAP_B, SUCCESSOR_A, GAP_A)
        second = self.contract.get_split(1, 2)
        self.assertTrue(second["used_cache"])
        self.assertEqual(self.snapshot_workspace()["semantic_eval_count"], 1)
        self.assertEqual(gl.nondet.calls, calls_after_first)

    def test_identical_candidate_in_new_workspace_does_not_cross_workspace_cache(self):
        queue_verdict(self.mod.SPLIT_HAS_GAP)
        self.contract.propose_split(1, SUCCESSOR_A, GAP_A, SUCCESSOR_B, GAP_B)

        set_sender(OWNER)
        self.contract.create_workspace(PARENT)
        queue_verdict(self.mod.SPLIT_HAS_GAP)
        self.contract.propose_split(2, SUCCESSOR_A, GAP_A, SUCCESSOR_B, GAP_B)
        split = self.contract.get_split(2, 1)
        ws2 = self.snapshot_workspace(2)
        self.assertFalse(split["used_cache"])
        self.assertEqual(ws2["semantic_eval_count"], 1)

    def test_partial_acceptance_keeps_parent_active_and_creates_no_children(self):
        self.propose_covering_split()
        set_sender(SUCCESSOR_A)
        self.contract.accept_split(1, 1)

        split = self.contract.get_split(1, 1)
        workspace = self.snapshot_workspace()
        self.assertTrue(split["accepted_a"])
        self.assertFalse(split["accepted_b"])
        self.assertFalse(split["activated"])
        self.assertEqual(split["status"], self.mod.SPLIT_PENDING)
        self.assertEqual(workspace["parent_status"], self.mod.PARENT_ACTIVE)
        self.assertEqual(workspace["current_responsible"], Address(OWNER))
        self.assertEqual(workspace["epoch"], 0)
        self.assertEqual(workspace["active_split_id"], 1)
        self.assertEqual(workspace["active_children_count"], 0)
        self.assertEqual(len(self.contract.children), 0)

    def test_final_acceptance_activates_exact_children_and_closes_parent(self):
        self.propose_covering_split()
        set_sender(SUCCESSOR_A)
        self.contract.accept_split(1, 1)
        set_sender(SUCCESSOR_B)
        self.contract.accept_split(1, 1)

        split = self.contract.get_split(1, 1)
        workspace = self.snapshot_workspace()
        child_a = self.contract.get_child(1, 1)
        child_b = self.contract.get_child(1, 2)

        self.assertTrue(split["accepted_a"] and split["accepted_b"])
        self.assertTrue(split["activated"])
        self.assertEqual(split["status"], self.mod.SPLIT_ACTIVATED)
        self.assertEqual(workspace["parent_status"], self.mod.PARENT_CLOSED)
        self.assertEqual(workspace["current_responsible"], Address(self.mod.ZERO_ADDRESS))
        self.assertEqual(workspace["epoch"], 1)
        self.assertEqual(workspace["active_split_id"], 0)
        self.assertEqual(workspace["active_children_count"], 2)

        self.assertEqual(child_a["responsible"], Address(SUCCESSOR_A))
        self.assertEqual(child_a["charter_text"], COVER_A)
        self.assertEqual(child_a["source_split_id"], 1)
        self.assertEqual(child_a["epoch"], 1)
        self.assertTrue(child_a["active"])

        self.assertEqual(child_b["responsible"], Address(SUCCESSOR_B))
        self.assertEqual(child_b["charter_text"], COVER_B)
        self.assertEqual(child_b["source_split_id"], 1)
        self.assertEqual(child_b["epoch"], 1)
        self.assertTrue(child_b["active"])

        # Terminal state is non-replayable and cannot be bypassed by another split.
        with self.assertRaisesRegex(UserError, "already closed"):
            self.contract.accept_split(1, 1)
        set_sender(OWNER)
        with self.assertRaisesRegex(UserError, "already closed"):
            self.contract.propose_split(1, SUCCESSOR_A, COVER_A, SUCCESSOR_B, COVER_B)
        with self.assertRaisesRegex(UserError, "already closed"):
            self.contract.withdraw_split(1, 1)

    def test_withdrawal_clears_pending_split_without_moving_responsibility(self):
        self.propose_covering_split()
        set_sender(OWNER)
        self.contract.withdraw_split(1, 1)

        split = self.contract.get_split(1, 1)
        workspace = self.snapshot_workspace()
        self.assertTrue(split["withdrawn"])
        self.assertEqual(split["status"], self.mod.SPLIT_WITHDRAWN)
        self.assertEqual(workspace["parent_status"], self.mod.PARENT_ACTIVE)
        self.assertEqual(workspace["current_responsible"], Address(OWNER))
        self.assertEqual(workspace["epoch"], 0)
        self.assertEqual(workspace["active_split_id"], 0)
        self.assertEqual(workspace["active_children_count"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
