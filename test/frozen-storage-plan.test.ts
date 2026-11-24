import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createOwnedCase } from "../src/adapters/create-owned-case.ts";
import { planOwnedCase, runOwnedCase } from "../src/adapters/run-owned-case.ts";

test("qualification reserves frozen inputs and completion records before opening a run", async () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-frozen-cap-"));
  try {
    const folder = join(root, "case"),
      output = join(root, "run");
    createOwnedCase(folder);
    const packetPath = join(folder, "evidence.json"),
      experimentPath = join(folder, "experiment.json");
    const packet = JSON.parse(readFileSync(packetPath, "utf8"));
    const experiment = JSON.parse(readFileSync(experimentPath, "utf8"));
    const template = packet.sources[0];
    const hash = (text: string) =>
      createHash("sha256").update(text).digest("hex");
    packet.sources = Array.from({ length: 5 }, (_, index) => {
      const content = String(index).repeat(2 * 1024 * 1024);
      const storedPath = `sources/large-${index}.md`;
      writeFileSync(join(folder, storedPath), content);
      return {
        ...template,
        storedPath,
        contentSha256: hash(content),
        excerpt: content.slice(0, 10),
      };
    });
    const save = () => {
      const raw = JSON.stringify(packet);
      writeFileSync(packetPath, raw);
      experiment.evidenceHash = hash(raw);
      writeFileSync(experimentPath, JSON.stringify(experiment));
    };
    save();
    await assert.rejects(planOwnedCase(folder), /retained byte limit/i);
    await assert.rejects(runOwnedCase(folder, output), /retained byte limit/i);
    assert.equal(existsSync(output), false);
    for (const value of ["ignored", -4]) {
      experiment.phases.extra = value;
      save();
      await assert.rejects(planOwnedCase(folder), /retained byte limit/i);
    }
    delete experiment.phases.extra;
    packet.sources = packet.sources.map((source: object) => ({
      ...source,
      storedPath: packet.sources[0].storedPath,
      contentSha256: packet.sources[0].contentSha256,
    }));
    save();
    assert.equal(
      (await planOwnedCase(folder)).status,
      "qualified-replay-inputs",
    );
    const expanded = "&".repeat(1700000);
    writeFileSync(join(folder, template.storedPath), expanded);
    packet.sources = [
      { ...template, contentSha256: hash(expanded), excerpt: expanded },
    ];
    experiment.limits.retainedBytes = 12000000;
    save();
    await assert.rejects(planOwnedCase(folder), /retained byte limit/i);
    await assert.rejects(runOwnedCase(folder, output), /retained byte limit/i);
    assert.equal(existsSync(output), false);
  } finally {
    if (!root.startsWith(join(tmpdir(), "deadcodefix-frozen-cap-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
