import { createHash, randomUUID } from "node:crypto";
import { isUtf8 } from "node:buffer";
import {
  mkdirSync,
  lstatSync,
  existsSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  linkSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { join, resolve, basename } from "node:path";
import type { RunAttempt } from "./index.ts";
export interface RawReference {
  path: string;
  sha256: string;
}
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const registrationText = (
  registration: unknown,
  cap: number,
  createdAt: number,
) =>
  JSON.stringify({
    schemaVersion: 1,
    registration,
    retainedBytes: cap,
    createdAt,
  });
export function qualifyInitialStorage(
  registration: unknown,
  cap: number,
  durationMs: number,
  additionalBytes = 0,
) {
  const createdAt = Date.now();
  const required =
    Buffer.byteLength(registrationText(registration, cap, createdAt)) +
    Buffer.byteLength(
      JSON.stringify({
        durationMs,
        startedAt: createdAt,
        deadline: createdAt + durationMs,
      }),
    ) +
    Buffer.byteLength(String(process.pid)) +
    additionalBytes;
  if (!Number.isSafeInteger(required) || required > cap)
    throw new Error(
      "Retained byte limit cannot hold run inputs and completion records",
    );
}
export class RunStore {
  private folder: string;
  private cap: number;
  private closed = false;
  private lock: string;
  private createdAt = Date.now();
  private resumed = false;
  constructor(folder: string, registration: unknown, cap: number) {
    if (!Number.isSafeInteger(cap) || cap <= 0)
      throw new Error("Invalid retained byte limit");
    this.folder = resolve(folder);
    this.cap = cap;
    mkdirSync(this.folder, { recursive: true });
    this.directory(this.folder);
    const writers = join(this.folder, "writers");
    mkdirSync(writers, { recursive: true });
    this.directory(writers);
    this.lock = join(writers, `${process.pid}-${randomUUID()}.lock`);
    writeFileSync(this.lock, String(process.pid), { flag: "wx" });
    try {
      const otherWriters = readdirSync(writers).map((name) =>
        join(writers, name),
      );
      const legacy = join(this.folder, "writer.lock");
      if (existsSync(legacy)) otherWriters.push(legacy);
      for (const path of otherWriters) {
        if (path === this.lock) continue;
        let pid: number;
        try {
          const payload = this.readFile(path);
          const owner = basename(path).match(
            /^([1-9][0-9]*)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.lock$/,
          );
          pid = Number(owner ? owner[1] : payload);
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ENOENT"
          )
            continue;
          throw error;
        }
        if (!Number.isSafeInteger(pid) || pid < 1)
          throw new Error("Invalid writer identity");
        let active = true;
        try {
          process.kill(pid, 0);
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ESRCH"
          )
            active = false;
        }
        if (active)
          throw new Error(
            "Another writer is active or cannot be verified as stopped",
          );
      }
      const objects = join(this.folder, "objects");
      mkdirSync(objects, { recursive: true });
      this.directory(objects);
      const destination = join(this.folder, "registration.json");
      this.resumed = existsSync(destination);
      if (this.resumed) {
        const previous = JSON.parse(this.readFile(destination));
        if (
          !Number.isSafeInteger(previous.createdAt) ||
          previous.createdAt < 0 ||
          previous.createdAt > Date.now()
        )
          throw new Error("Invalid run registration creation time");
        this.createdAt = previous.createdAt;
      }
      const serialized = registrationText(registration, cap, this.createdAt);
      if (existsSync(destination)) {
        if (this.readFile(destination) !== serialized)
          throw new Error("Run registration changed");
      } else this.atomic(destination, serialized);
    } catch (error) {
      this.close();
      throw error;
    }
  }
  getRunDeadline(durationMs: number): number {
    if (this.closed) throw new Error("Run storage is closed");
    if (
      !Number.isSafeInteger(durationMs) ||
      durationMs < 1 ||
      durationMs > 2147483647
    )
      throw new Error("Invalid run deadline");
    const path = join(this.folder, "deadline.json");
    if (!existsSync(path)) {
      if (
        this.resumed &&
        (readdirSync(join(this.folder, "objects")).length > 0 ||
          readdirSync(this.folder).some(
            (name) =>
              !["registration.json", "objects", "writers"].includes(name) &&
              !name.startsWith("partial-"),
          ))
      )
        throw new Error("Missing deadline for an existing run");
      if (
        readdirSync(this.folder).some((name) => name.endsWith(".started.json"))
      )
        throw new Error("Missing deadline for an existing run");
      const startedAt = this.createdAt;
      this.atomic(
        path,
        JSON.stringify({
          durationMs,
          startedAt,
          deadline: startedAt + durationMs,
        }),
      );
    }
    const saved = JSON.parse(this.readFile(path));
    if (
      saved.durationMs !== durationMs ||
      saved.startedAt !== this.createdAt ||
      !Number.isSafeInteger(saved.startedAt) ||
      !Number.isSafeInteger(saved.deadline) ||
      saved.deadline !== saved.startedAt + durationMs ||
      saved.startedAt > Date.now()
    )
      throw new Error("Invalid or changed run deadline");
    return saved.deadline;
  }
  private directory(path: string) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Run directory must not be a link");
  }
  private readFile(path: string): string {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > this.cap)
      throw new Error("Unsafe or oversized run artifact");
    const bytes = readFileSync(path);
    if (!isUtf8(bytes)) throw new Error("Stored artifact must be valid UTF-8");
    return bytes.toString("utf8");
  }
  private used(path = this.folder): number {
    let count = 0;
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      const stat = lstatSync(child);
      if (stat.isSymbolicLink())
        throw new Error("Links are not allowed in run storage");
      if (stat.isDirectory()) count += this.used(child);
      else if (stat.isFile()) count += stat.size;
      else throw new Error("Unexpected run storage entry");
      if (count > this.cap) throw new Error("Retained byte limit exceeded");
    }
    return count;
  }
  private atomic(path: string, text: string) {
    if (this.closed) throw new Error("Run storage is closed");
    if (this.used() + Buffer.byteLength(text) > this.cap)
      throw new Error("Retained byte limit exceeded");
    const temp = join(this.folder, "partial-" + randomUUID());
    const fd = openSync(temp, "wx");
    try {
      writeFileSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temp, path);
    } finally {
      unlinkSync(temp);
    }
  }
  saveRaw(raw: string): RawReference {
    if (this.closed) throw new Error("Run storage is closed");
    const sha256 = digest(raw);
    const path = "objects/" + sha256 + ".txt";
    const destination = join(this.folder, path);
    if (existsSync(destination)) {
      if (this.readFile(destination) !== raw)
        throw new Error("Stored artifact hash mismatch");
    } else this.atomic(destination, raw);
    return { path, sha256 };
  }
  readRaw(ref: RawReference): string {
    if (
      !/^[a-f0-9]{64}$/.test(ref.sha256) ||
      ref.path !== "objects/" + ref.sha256 + ".txt"
    )
      throw new Error("Invalid artifact reference");
    const text = this.readFile(join(this.folder, ref.path));
    if (digest(text) !== ref.sha256)
      throw new Error("Stored artifact hash mismatch");
    return text;
  }
  readRehearsal(): RawReference | null {
    const path = join(this.folder, "rehearsal.json");
    if (!existsSync(path)) return null;
    const ref: RawReference = JSON.parse(this.readFile(path));
    this.readRaw(ref);
    return ref;
  }
  publishRehearsal(value: unknown): RawReference {
    const text = JSON.stringify(value);
    const existing = this.readRehearsal();
    if (existing) {
      if (this.readRaw(existing) !== text)
        throw new Error("Verifier rehearsal is immutable");
      return existing;
    }
    const ref = this.saveRaw(text);
    this.atomic(join(this.folder, "rehearsal.json"), JSON.stringify(ref));
    return ref;
  }
  private slotPath(id: string, kind: "started" | "complete"): string {
    if (!/^(smoke|pilot|main)-[1-9][0-9]*-[ABC]$/.test(id))
      throw new Error("Invalid slot ID");
    return join(this.folder, `${id}.${kind}.json`);
  }
  readStartedAt(id: string): string {
    const marker = JSON.parse(this.readFile(this.slotPath(id, "started")));
    if (
      marker.id !== id ||
      typeof marker.startedAt !== "string" ||
      !Number.isFinite(Date.parse(marker.startedAt))
    )
      throw new Error("Started marker differs from its slot");
    return marker.startedAt;
  }
  beginAttempt(id: string, startedAt = new Date().toISOString()): boolean {
    if (this.closed) throw new Error("Run storage is closed");
    const path = this.slotPath(id, "started");
    if (existsSync(path)) {
      this.readStartedAt(id);
      return false;
    }
    this.atomic(path, JSON.stringify({ id, startedAt }));
    return true;
  }
  completeAttempt(receipt: RunAttempt): void {
    if (!existsSync(this.slotPath(receipt.id, "started")))
      throw new Error("Slot has not started");
    if (this.readStartedAt(receipt.id) !== receipt.startedAt)
      throw new Error("Started marker differs from its receipt");
    const reference = this.saveRaw(JSON.stringify(receipt));
    this.atomic(
      this.slotPath(receipt.id, "complete"),
      JSON.stringify(reference),
    );
  }
  readAttempt(id: string): RunAttempt | null {
    const path = this.slotPath(id, "complete");
    if (!existsSync(path)) return null;
    const reference: RawReference = JSON.parse(this.readFile(path));
    const receipt: RunAttempt = JSON.parse(this.readRaw(reference));
    if (receipt.id !== id) throw new Error("Slot receipt mismatch");
    if (this.readStartedAt(id) !== receipt.startedAt)
      throw new Error("Started marker differs from its receipt");
    if (receipt.rawPath !== null || receipt.rawHash !== null) {
      if (!receipt.rawPath || !receipt.rawHash)
        throw new Error("Incomplete raw response reference");
      this.readRaw({ path: receipt.rawPath, sha256: receipt.rawHash });
    }
    for (const check of receipt.verification?.checks ?? [])
      if (check.observation) this.readRaw(check.observation);
    return receipt;
  }
  close() {
    if (!this.closed) {
      unlinkSync(this.lock);
      this.closed = true;
    }
  }
  publishSummary(summary: unknown): void {
    const text = JSON.stringify(summary);
    const destination = join(this.folder, "summary.json");
    if (existsSync(destination)) {
      const previous: RawReference = JSON.parse(this.readFile(destination));
      if (this.readRaw(previous) !== text)
        throw new Error("Run summary is immutable");
      return;
    }
    const reference = this.saveRaw(text);
    this.atomic(destination, JSON.stringify(reference));
  }
}
