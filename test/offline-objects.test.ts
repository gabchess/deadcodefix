import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { inspectRepository } from "../src/inspect-repository/index.ts";

test("inspection never fetches a missing promised object", () => {
  const root = mkdtempSync(join(tmpdir(), "deadcodefix-offline-object-"));
  const previousTrace = process.env.GIT_TRACE2_EVENT;
  const previousProtocol = process.env.GIT_ALLOW_PROTOCOL;
  try {
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "core.autocrlf=false",
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          ...args,
        ],
        { cwd: root, encoding: "utf8" },
      ).trim();
    git("init", "-q");
    writeFileSync(join(root, "harness.ts"), "owned\n");
    git("add", "harness.ts");
    git("commit", "-qm", "Owned fixture");
    const sha = git("rev-parse", "HEAD");
    const blob = git("rev-parse", "HEAD:harness.ts");
    git("config", "remote.origin.url", join(root, "absent-promisor"));
    git("config", "remote.origin.promisor", "true");
    git("config", "extensions.partialClone", "origin");
    const object = resolve(
      root,
      ".git",
      "objects",
      blob.slice(0, 2),
      blob.slice(2),
    );
    assert.ok(
      object.startsWith(resolve(root, ".git", "objects") + "/") ||
        object.startsWith(resolve(root, ".git", "objects") + "\\"),
    );
    unlinkSync(object);
    const trace = join(root, ".git", "offline-trace.jsonl");
    process.env.GIT_TRACE2_EVENT = trace;
    process.env.GIT_ALLOW_PROTOCOL = "file";
    assert.throws(() => inspectRepository({ repo: root, ref: sha }));
    const events = readFileSync(trace, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(
      events.some(
        (event) =>
          event.event === "child_start" && event.argv?.includes("fetch"),
      ),
      false,
      "Offline inspection launched git fetch",
    );
  } finally {
    if (previousTrace === undefined) delete process.env.GIT_TRACE2_EVENT;
    else process.env.GIT_TRACE2_EVENT = previousTrace;
    if (previousProtocol === undefined) delete process.env.GIT_ALLOW_PROTOCOL;
    else process.env.GIT_ALLOW_PROTOCOL = previousProtocol;
    if (!root.startsWith(join(tmpdir(), "deadcodefix-offline-object-")))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
