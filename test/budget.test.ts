import test from "node:test";
import assert from "node:assert/strict";
import { BudgetLedger } from "../src/run-comparison/budget.ts";

const policy = {
  approvalId: "offline-test-only",
  totalCapMicros: 100,
  attemptCapMicros: 70,
  maxCallsPerAttempt: 2,
  inputTokens: 1000,
  outputTokens: 200,
};
const request = (callId: string, attemptId = "smoke-1-B", maxMicros = 40) => ({
  callId,
  attemptId,
  maxMicros,
  inputTokens: 100,
  outputTokens: 100,
});

test("reserve before dispatch against attempt and shared phase budgets", () => {
  assert.throws(
    () => new BudgetLedger({ ...policy, approvalId: "" }),
    /approval/i,
  );
  const ledger = new BudgetLedger(policy);
  ledger.reserve(request("one"));
  ledger.reconcile("one", 30);
  assert.throws(
    () => ledger.reserve(request("too-large", "smoke-1-B", 41)),
    /attempt/i,
  );
  ledger.reserve(request("two"));
  ledger.reconcile("two", 40);
  assert.throws(
    () => ledger.reserve(request("too-many", "smoke-1-B", 0)),
    /call/i,
  );
  assert.throws(
    () => ledger.reserve(request("pilot", "pilot-1-C", 31)),
    /total/i,
  );
  ledger.reserve(request("main", "main-1-C", 30));
  ledger.reconcile("main", 30);
  assert.throws(
    () => ledger.reserve(request("exhausted", "main-2-C", 1)),
    /total/i,
  );
  assert.equal(ledger.snapshot().length, 6);
});

test("uncertain or interrupted calls block retry until durable reconciliation", () => {
  const ledger = new BudgetLedger(policy);
  ledger.reserve(request("one"));
  const resumed = new BudgetLedger(policy, ledger.snapshot());
  assert.throws(() => resumed.reserve(request("retry")), /unreconciled/i);
  resumed.reconcile("one", null);
  const uncertain = new BudgetLedger(policy, resumed.snapshot());
  assert.throws(() => uncertain.reserve(request("retry")), /unreconciled/i);
  uncertain.reconcile("one", 20);
  assert.throws(() => uncertain.reserve(request("one")), /duplicate/i);
  uncertain.reserve(request("next", "main-1-C"));
  assert.throws(() => uncertain.reconcile("next", 41), /reservation/i);
  assert.throws(() => uncertain.reserve(request("retry")), /unreconciled/i);
});

test("token ceilings and failed reservation storage prevent admission", () => {
  const ledger = new BudgetLedger(policy, [], () => {
    throw new Error("disk unavailable");
  });
  assert.throws(() => ledger.reserve(request("one")), /disk unavailable/);
  assert.deepEqual(ledger.snapshot(), []);
  const other = new BudgetLedger(policy);
  assert.throws(
    () =>
      other.reserve({
        ...request("one"),
        callId: undefined,
      } as unknown as ReturnType<typeof request>),
    /reservation/i,
  );
  assert.throws(
    () => other.reserve({ ...request("one"), outputTokens: 201 }),
    /token/i,
  );
  assert.throws(
    () => other.reserve({ ...request("one"), maxMicros: -1 }),
    /reservation/i,
  );
  assert.throws(
    () =>
      new BudgetLedger({
        ...policy,
        totalCapMicros: Number.MAX_SAFE_INTEGER + 1,
      }),
    /limit/i,
  );
});
