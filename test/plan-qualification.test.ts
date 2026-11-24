import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createOwnedCase } from "../src/adapters/create-owned-case.ts";
import { runCommands } from "../src/cli/commands.ts";

test("plan exposes owned replay blockers before execution", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-plan-qualification-"));
  try {
    const folder = join(root, "case");
    createOwnedCase(folder);
    const plan = () => runCommands(["plan", "--case", folder], () => {});
    assert.equal(await plan(), 0);
    await t.test(
      "large disk allowance cannot exceed receipt readback capacity",
      async () => {
        const path = join(folder, "experiment.json");
        const original = readFileSync(path);
        const experiment = JSON.parse(original.toString());
        experiment.phases.main = 4998;
        experiment.limits.retainedBytes = 16 * 1024 * 1024 * 1024;
        writeFileSync(path, JSON.stringify(experiment));
        try {
          assert.equal(await plan(), 1);
        } finally {
          writeFileSync(path, original);
        }
      },
    );
    await t.test("initial storage must fit before qualification", async () => {
      const path = join(folder, "experiment.json");
      const original = readFileSync(path);
      const experiment = JSON.parse(original.toString());
      experiment.limits.retainedBytes = 1;
      writeFileSync(path, JSON.stringify(experiment));
      try {
        assert.equal(await plan(), 1);
      } finally {
        writeFileSync(path, original);
      }
    });
    await t.test("missing recording blocks qualification", async () => {
      const path = join(folder, "records", "B.json");
      const backup = join(folder, "records", "B.saved");
      assert.ok(path.startsWith(root) && backup.startsWith(root));
      renameSync(path, backup);
      try {
        assert.equal(await plan(), 1);
      } finally {
        renameSync(backup, path);
      }
    });
    await t.test("unsupported verifier blocks qualification", async () => {
      const path = join(folder, "verifier.json");
      const original = readFileSync(path);
      const experimentPath = join(folder, "experiment.json");
      const originalExperiment = readFileSync(experimentPath);
      const experiment = JSON.parse(originalExperiment.toString());
      const raw = JSON.stringify({ kind: "unqualified" });
      writeFileSync(path, raw);
      experiment.verifierHash = createHash("sha256").update(raw).digest("hex");
      writeFileSync(experimentPath, JSON.stringify(experiment));
      try {
        assert.equal(await plan(), 1);
      } finally {
        writeFileSync(path, original);
        writeFileSync(experimentPath, originalExperiment);
      }
    });
    await t.test("evidence belongs to the registered case", async () => {
      const packetPath = join(folder, "evidence.json");
      const experimentPath = join(folder, "experiment.json");
      const savedPacket = readFileSync(packetPath);
      const savedExperiment = readFileSync(experimentPath);
      const packet = JSON.parse(savedPacket.toString());
      const experiment = JSON.parse(savedExperiment.toString());
      packet.caseId = "another-case";
      const raw = JSON.stringify(packet);
      experiment.evidenceHash = createHash("sha256").update(raw).digest("hex");
      writeFileSync(packetPath, raw);
      writeFileSync(experimentPath, JSON.stringify(experiment));
      try {
        assert.equal(await plan(), 1);
      } finally {
        writeFileSync(packetPath, savedPacket);
        writeFileSync(experimentPath, savedExperiment);
      }
    });
    await t.test(
      "case JSON cannot normalize invalid evidence bytes",
      async () => {
        const packetPath = join(folder, "evidence.json");
        const experimentPath = join(folder, "experiment.json");
        const savedPacket = readFileSync(packetPath);
        const savedExperiment = readFileSync(experimentPath);
        const raw = Buffer.from(savedPacket);
        const offset = raw.indexOf("Synthetic");
        assert.ok(offset >= 0);
        raw[offset] = 0xff;
        const experiment = JSON.parse(savedExperiment.toString());
        experiment.evidenceHash = createHash("sha256")
          .update(raw)
          .digest("hex");
        writeFileSync(packetPath, raw);
        writeFileSync(experimentPath, JSON.stringify(experiment));
        try {
          assert.equal(await plan(), 2);
        } finally {
          writeFileSync(packetPath, savedPacket);
          writeFileSync(experimentPath, savedExperiment);
        }
      },
    );
    await t.test(
      "matching verifier kind cannot admit an unknown schema version",
      async () => {
        const path = join(folder, "verifier.json");
        const original = readFileSync(path);
        const experimentPath = join(folder, "experiment.json");
        const savedExperiment = readFileSync(experimentPath);
        const verifier = JSON.parse(original.toString());
        verifier.schemaVersion = 2;
        const raw = JSON.stringify(verifier);
        const experiment = JSON.parse(savedExperiment.toString());
        experiment.verifierHash = createHash("sha256")
          .update(raw)
          .digest("hex");
        writeFileSync(path, raw);
        writeFileSync(experimentPath, JSON.stringify(experiment));
        try {
          assert.equal(await plan(), 1);
        } finally {
          writeFileSync(path, original);
          writeFileSync(experimentPath, savedExperiment);
        }
      },
    );
    await t.test("evidence host policy is checked by plan", async () => {
      writeFileSync(
        join(folder, "evidence-policy.json"),
        JSON.stringify({
          allowedHosts: ["other.invalid"],
          expectedVersion: "owned-v2",
        }),
      );
      assert.equal(await plan(), 1);
    });
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-plan-qualification-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
