import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  lstatSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createOwnedCase } from "../src/adapters/create-owned-case.ts";
import { runOwnedCase } from "../src/adapters/run-owned-case.ts";
import { readSavedRun, writeReport } from "../src/prepare-repair/saved-run.ts";
import type { ReportRun } from "../src/prepare-repair/index.ts";
import { RunStore } from "../src/run-comparison/store.ts";

test("saved reports verify provenance relationships as well as individual hashes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-provenance-"));
  try {
    const folder = join(root, "case");
    const output = join(root, "run");
    createOwnedCase(folder);
    const original = await runOwnedCase(folder, output);
    await t.test("parseable start timestamp changes are rejected", () => {
      const path = join(output, original.attempts[0].id + ".started.json");
      const bytes = readFileSync(path);
      const marker = JSON.parse(bytes.toString());
      marker.startedAt = "1970-01-01T00:00:00.000Z";
      writeFileSync(path, JSON.stringify(marker));
      try {
        assert.throws(() => readSavedRun(output), /started/i);
      } finally {
        writeFileSync(path, bytes);
      }
    });
    await t.test("export metadata must remain bound to the saved run", () => {
      for (const name of [
        "rehearsal.json",
        "deadline.json",
        original.attempts[0].id + ".started.json",
      ]) {
        const path = join(output, name);
        const bytes = readFileSync(path);
        writeFileSync(path, "{}");
        try {
          assert.throws(
            () => readSavedRun(output),
            /rehearsal|deadline|started/i,
          );
        } finally {
          writeFileSync(path, bytes);
        }
      }
    });
    const save = (value: unknown) => {
      const raw = JSON.stringify(value);
      const sha256 = createHash("sha256").update(raw).digest("hex");
      const path = "objects/" + sha256 + ".txt";
      writeFileSync(join(output, path), raw);
      return { path, sha256 };
    };
    const publish = (run: ReportRun) => {
      for (const attempt of run.attempts)
        writeFileSync(
          join(output, attempt.id + ".complete.json"),
          JSON.stringify(save(attempt)),
        );
      writeFileSync(join(output, "summary.json"), JSON.stringify(save(run)));
    };
    await t.test(
      "rehearsal observations must be readable before export",
      () => {
        const pointer = join(output, "rehearsal.json");
        const previous = readFileSync(pointer);
        const rehearsal = JSON.parse(
          readFileSync(join(output, original.rehearsal.path), "utf8"),
        );
        rehearsal.correct.checks[0].observation = {
          path: "objects/" + "0".repeat(64) + ".txt",
          sha256: "0".repeat(64),
        };
        const changed = structuredClone(original);
        changed.rehearsal = save(rehearsal);
        writeFileSync(pointer, JSON.stringify(changed.rehearsal));
        publish(changed);
        try {
          assert.throws(
            () => readSavedRun(output),
            /ENOENT|artifact|observation/i,
          );
        } finally {
          writeFileSync(pointer, previous);
          publish(original);
        }
      },
    );
    await t.test("source metadata must match the frozen packet", () => {
      const changed = structuredClone(original);
      changed.sources[0].url = "https://example.invalid/unrelated";
      publish(changed);
      assert.throws(() => readSavedRun(output), /Source metadata differs/);
    });
    await t.test("raw response must match its registered arm", () => {
      const changed = structuredClone(original);
      changed.attempts[0].rawHash = changed.attempts[1].rawHash;
      changed.attempts[0].rawPath = changed.attempts[1].rawPath;
      publish(changed);
      assert.throws(() => readSavedRun(output), /registered arm/);
    });
    await t.test("observation must agree with the displayed check", () => {
      const changed = structuredClone(original);
      const check = changed.attempts[0].verification!.checks[0];
      const observation = JSON.parse(
        readFileSync(join(output, check.observation!.path), "utf8"),
      );
      observation.observed.stdout = "unrelated output";
      check.observation = save(observation);
      publish(changed);
      assert.throws(() => readSavedRun(output), /observation differs/);
    });
    await t.test("report exposes raw verifier observations", () => {
      publish(original);
      const report = writeReport(output);
      const observation =
        original.attempts[0].verification!.checks[0].observation!;
      assert.ok(
        readFileSync(report.html, "utf8").includes(
          `href="${observation.path}"`,
        ),
      );
      assert.ok(
        readFileSync(report.markdown, "utf8").includes(
          `](${observation.path})`,
        ),
      );
    });
    await t.test(
      "report replacement respects peak storage before staging",
      () => {
        publish(original);
        const report = writeReport(output);
        const registrationPath = join(output, "registration.json");
        const registration = readFileSync(registrationPath);
        const previous = readFileSync(report.html);
        const used = (path: string): number =>
          readdirSync(path).reduce((total, name) => {
            const child = join(path, name);
            return (
              total +
              (lstatSync(child).isDirectory()
                ? used(child)
                : lstatSync(child).size)
            );
          }, 0);
        const envelope = JSON.parse(registration.toString());
        envelope.retainedBytes = used(output) + Math.floor(previous.length / 2);
        writeFileSync(registrationPath, JSON.stringify(envelope));
        writeFileSync(report.html, Buffer.alloc(previous.length, 0x78));
        try {
          assert.throws(() => writeReport(output), /retained byte limit/i);
        } finally {
          writeFileSync(registrationPath, registration);
          writeFileSync(report.html, previous);
        }
      },
    );
    await t.test("report publication excludes an active run writer", () => {
      publish(original);
      const envelope = JSON.parse(
        readFileSync(join(output, "registration.json"), "utf8"),
      );
      const writer = new RunStore(
        output,
        envelope.registration,
        envelope.retainedBytes,
      );
      try {
        assert.throws(() => writeReport(output), /Another writer/i);
      } finally {
        writer.close();
      }
    });
    await t.test("a success label cannot override a failed verifier", () => {
      const changed = structuredClone(original);
      changed.attempts[0].disposition = "pass";
      publish(changed);
      assert.throws(() => readSavedRun(output), /disposition|verdict/i);
    });
    await t.test(
      "check labels are derived from raw outputs and expectations",
      () => {
        const changed = structuredClone(original);
        const attempt = changed.attempts[0];
        attempt.disposition = "pass";
        attempt.verification!.status = "pass";
        for (const check of attempt.verification!.checks) check.passed = true;
        publish(changed);
        assert.throws(() => readSavedRun(output), /check verdict/i);
      },
    );
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-provenance-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
