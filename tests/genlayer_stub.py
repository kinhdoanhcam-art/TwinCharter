"""Minimal deterministic GenLayer runtime stub for tracked TwinCharter behavior tests.

The stub intentionally implements only the primitives used by contracts/TwinCharter.py.
It executes the frozen contract methods directly while allowing tests to control sender
identity and nondeterministic validator responses.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import importlib.util
from pathlib import Path
import sys
import types
from typing import Any


class u256(int):
    def __new__(cls, value: Any = 0):
        parsed = int(value)
        if parsed < 0:
            raise ValueError("u256 cannot be negative")
        return int.__new__(cls, parsed)


class Address(str):
    def __new__(cls, value: Any):
        text = str(value)
        if not text.startswith("0x") or len(text) != 42:
            raise ValueError(f"Invalid address: {text}")
        return str.__new__(cls, text.lower())


class TreeMap(dict):
    pass


class Keccak256:
    """Dependency-free deterministic digest stand-in for cache-behavior tests.

    The tests never assert a concrete digest; they assert key reuse/isolation semantics.
    """

    def __init__(self, data: bytes):
        self._data = data

    def hexdigest(self) -> str:
        return hashlib.sha3_256(self._data).hexdigest()


class Contract:
    pass


class UserError(Exception):
    pass


@dataclass
class Return:
    calldata: Any


class _Public:
    @staticmethod
    def write(fn):
        return fn

    @staticmethod
    def view(fn):
        return fn


class _Message:
    sender_address = Address("0x0000000000000000000000000000000000000001")


class _Nondet:
    def __init__(self):
        self.responses: list[Any] = []
        self.calls = 0

    def reset(self):
        self.responses.clear()
        self.calls = 0

    def queue(self, *responses: Any):
        self.responses.extend(responses)

    def exec_prompt(self, prompt: str, response_format: str = "json"):
        self.calls += 1
        if not self.responses:
            raise RuntimeError("No queued nondeterministic response")
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


class _VM:
    UserError = UserError
    Return = Return

    def __init__(self, nondet: _Nondet):
        self._nondet = nondet

    def run_nondet_unsafe(self, evaluate_once, validator_fn):
        leader = Return(evaluate_once())
        if not validator_fn(leader):
            raise UserError("Nondeterministic consensus did not converge")
        return leader


class _GL:
    Contract = Contract
    public = _Public()
    message = _Message()

    def __init__(self):
        self.nondet = _Nondet()
        self.vm = _VM(self.nondet)


gl = _GL()


def allow_storage(cls):
    return cls


def _install_genlayer_module() -> None:
    module = types.ModuleType("genlayer")
    exports = {
        "gl": gl,
        "allow_storage": allow_storage,
        "Address": Address,
        "u256": u256,
        "TreeMap": TreeMap,
        "Keccak256": Keccak256,
    }
    module.__dict__.update(exports)
    module.__all__ = list(exports)
    sys.modules["genlayer"] = module


def load_contract(contract_path: Path):
    """Load the exact contract source under the local runtime stub."""
    _install_genlayer_module()
    module_name = "twincharter_contract_under_test"
    sys.modules.pop(module_name, None)
    spec = importlib.util.spec_from_file_location(module_name, contract_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load contract: {contract_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def fresh_contract(contract_module):
    contract = contract_module.ResponsibilitySplit()
    # GenLayer storage descriptors are materialized by the chain runtime. The
    # local harness materializes only the four maps used by this exact source.
    contract.workspaces = TreeMap()
    contract.splits = TreeMap()
    contract.children = TreeMap()
    contract.verdict_cache = TreeMap()
    return contract


def set_sender(address: str) -> None:
    gl.message.sender_address = Address(address)


def queue_verdict(verdict: str, copies: int = 2) -> None:
    for _ in range(copies):
        gl.nondet.queue({"verdict": verdict})
