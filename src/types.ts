export type Address = `0x${string}`;

export type SplitVerdict = 'SPLIT_COVERS_PARENT' | 'SPLIT_HAS_GAP';
export type SplitStatus = 'GAP' | 'PENDING_DUAL_ACCEPTANCE' | 'WITHDRAWN' | 'ACTIVATED';

export interface SplitConfig {
  name: string;
  version: string;
  semantic_verdicts: SplitVerdict[];
  arity: number;
  parent_charter_mutable: boolean;
  overlap_allowed: boolean;
  material_contradiction_fails_coverage: boolean;
  clock_used: boolean;
  max_splits_per_workspace: number;
  max_semantic_evals_per_workspace: number;
  cache_scope: string;
  workspace_count: number;
}

export interface Workspace {
  workspace_id: number;
  parent_charter: string;
  current_responsible: Address;
  parent_status: 'ACTIVE' | 'CLOSED';
  epoch: number;
  split_count: number;
  gap_attempts: number;
  semantic_eval_count: number;
  active_split_id: number;
  active_children_count: number;
}

export interface Split {
  workspace_id: number;
  split_id: number;
  proposer: Address;
  successor_a: Address;
  successor_b: Address;
  charter_a: string;
  charter_b: string;
  verdict: SplitVerdict;
  status: SplitStatus;
  accepted_a: boolean;
  accepted_b: boolean;
  withdrawn: boolean;
  activated: boolean;
  used_cache: boolean;
}

export interface Child {
  workspace_id: number;
  child_index: number;
  responsible: Address;
  charter_text: string;
  source_split_id: number;
  epoch: number;
  active: boolean;
}

export type TxHash = `0x${string}`;
