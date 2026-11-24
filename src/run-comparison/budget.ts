export interface BudgetPolicy {
  approvalId: string;
  totalCapMicros: number;
  attemptCapMicros: number;
  maxCallsPerAttempt: number;
  inputTokens: number;
  outputTokens: number;
}
export interface Reservation {
  callId: string;
  attemptId: string;
  maxMicros: number;
  inputTokens: number;
  outputTokens: number;
}
export type BudgetEvent =
  | { kind: "reserved"; request: Reservation }
  | { kind: "reconciled"; callId: string; chargedMicros: number | null };

const finite = (value: number) => Number.isSafeInteger(value) && value >= 0;

// Pure admission policy. A qualified transport must persist events before dispatch.
// Constructing this object does not authorize spending or enable a live adapter.
export class BudgetLedger {
  private policy: BudgetPolicy;
  private events: BudgetEvent[] = [];
  private calls = new Map<
    string,
    { request: Reservation; charged: number | null }
  >();
  private persist?: (event: BudgetEvent) => void;

  constructor(
    policy: BudgetPolicy,
    events: BudgetEvent[] = [],
    persist?: (event: BudgetEvent) => void,
  ) {
    if (typeof policy.approvalId !== "string" || !policy.approvalId.trim())
      throw new Error("Recorded approval is required");
    for (const key of [
      "totalCapMicros",
      "attemptCapMicros",
      "maxCallsPerAttempt",
      "inputTokens",
      "outputTokens",
    ] as const)
      if (!finite(policy[key])) throw new Error("Invalid budget limit");
    if (
      !policy.maxCallsPerAttempt ||
      !policy.inputTokens ||
      !policy.outputTokens
    )
      throw new Error("Call and token limits must be positive");
    this.policy = { ...policy };
    if (!Array.isArray(events) || events.length > 10000)
      throw new Error("Budget event limit exceeded");
    for (const event of events) {
      if (event.kind === "reserved") this.reserve(event.request);
      else if (event.kind === "reconciled")
        this.reconcile(event.callId, event.chargedMicros);
      else throw new Error("Unknown budget event");
    }
    this.persist = persist;
  }

  private record(event: BudgetEvent) {
    if (this.events.length >= 10000)
      throw new Error("Budget event limit exceeded");
    this.persist?.(structuredClone(event));
    this.events.push(structuredClone(event));
  }

  reserve(candidate: Reservation) {
    const request = { ...candidate };
    if (
      typeof request.callId !== "string" ||
      typeof request.attemptId !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(request.callId) ||
      !/^(smoke|pilot|main)-[1-9][0-9]*-[ABC]$/.test(request.attemptId) ||
      !finite(request.maxMicros)
    )
      throw new Error("Invalid reservation");
    if (this.calls.has(request.callId))
      throw new Error("Duplicate call reservation");
    if ([...this.calls.values()].some((call) => call.charged === null))
      throw new Error("Unreconciled reservation blocks dispatch");
    if (
      !finite(request.inputTokens) ||
      !finite(request.outputTokens) ||
      request.inputTokens > this.policy.inputTokens ||
      request.outputTokens > this.policy.outputTokens
    )
      throw new Error("Token ceiling exceeded");
    const calls = [...this.calls.values()];
    const attempt = calls.filter(
      (call) => call.request.attemptId === request.attemptId,
    );
    if (attempt.length >= this.policy.maxCallsPerAttempt)
      throw new Error("Attempt call limit exceeded");
    const used = (rows: typeof calls) =>
      rows.reduce(
        (sum, call) => sum + (call.charged ?? call.request.maxMicros),
        0,
      );
    if (request.maxMicros > this.policy.attemptCapMicros - used(attempt))
      throw new Error("Attempt budget exceeded");
    if (request.maxMicros > this.policy.totalCapMicros - used(calls))
      throw new Error("Total budget exceeded");
    this.record({ kind: "reserved", request });
    this.calls.set(request.callId, { request, charged: null });
  }

  reconcile(callId: string, chargedMicros: number | null) {
    const call = this.calls.get(callId);
    if (!call || call.charged !== null)
      throw new Error("No unresolved reservation");
    if (
      chargedMicros !== null &&
      (!finite(chargedMicros) || chargedMicros > call.request.maxMicros)
    )
      throw new Error(
        "Charge exceeds reservation; external reconciliation required",
      );
    this.record({ kind: "reconciled", callId, chargedMicros });
    call.charged = chargedMicros;
  }

  snapshot(): BudgetEvent[] {
    return structuredClone(this.events);
  }
}
