export type RuleType = "limit_order" | "scheduled" | "instant";
export type RuleAction = "swap" | "send" | "bridge" | "ritual_ping";
export type ActionStatus =
  | "pending"
  | "executing"
  | "executed"
  | "error"
  | "dry_run"
  | "skipped";

export interface TxRequest {
  chainId: number;
  to: string;
  /** native amount in whole units string e.g. "0.01" */
  valueNative?: string;
  data?: `0x${string}`;
  usdValue: number;
  summary: string;
  ruleId?: string;
  actionType: RuleAction | "approve";
}

export interface ExecResult {
  status: ActionStatus;
  txHash?: string;
  error?: string;
  actionId: string;
}
