import type { RunReceipt } from "../run-comparison/index.ts";
import type { RawReference } from "../run-comparison/store.ts";
import type { EvidenceSource } from "../collect-evidence/index.ts";
import type { ExperimentSpec } from "../design-comparison/contracts.ts";
import { summarizeMain } from "./statistics.ts";
export interface ReportRun extends RunReceipt {
  repoSHA: string;
  repairTree: string;
  patch: RawReference;
  evidence: RawReference;
  task: RawReference;
  rehearsal: RawReference;
  sources: (EvidenceSource & {
    status: "available" | "unknown";
    artifact: RawReference | null;
  })[];
  omissions: string[];
  oldModel: string;
  interpretation: string;
}
const escape = (value: unknown) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const md = (value: unknown) =>
  escape(value)
    .replace(/([\\`*_[\]{}()#+.!|>-])/g, "\\$1")
    .replace(/\r?\n/g, " ");
function link(ref: RawReference, label: string) {
  if (
    !/^[a-f0-9]{64}$/.test(ref.sha256) ||
    ref.path !== `objects/${ref.sha256}.txt`
  )
    throw new Error("Invalid report artifact link");
  return `<a href="${ref.path}">${escape(label)}</a>`;
}
export function buildReport(
  run: ReportRun,
  candidate: unknown,
  readRaw: (ref: RawReference) => string,
) {
  const stats = summarizeMain(run, candidate),
    spec = candidate as ExperimentSpec;
  if (run.mode !== "replay")
    throw new Error("Only replay reports are qualified");
  const patch = readRaw(run.patch);
  const percent = (n: number) => (n * 100).toFixed(1) + "%";
  const counts = Object.entries(stats.arms)
    .map(
      ([arm, a]) =>
        `<tr><th scope="row">${arm}</th><td>${a.planned}</td><td>${a.pass}</td><td>${a.fail}</td><td>${a.unknown}</td><td>${a.not_run}</td><td>${percent(a.conservativeCompletion)}</td><td>${a.interval ? a.interval.map(percent).join(" to ") : "Not calculated"}</td></tr>`,
    )
    .join("");
  const rows = run.attempts
    .map(
      (a) =>
        `<tr><th scope="row">${escape(a.id)}</th><td>${escape(a.phase)}</td><td>${escape(a.disposition)}</td><td>${a.rawPath && a.rawHash ? link({ path: a.rawPath, sha256: a.rawHash }, "Raw response") : "No raw response"}</td><td>${escape(a.reason)}</td></tr>`,
    )
    .join("");
  const checks = run.attempts
    .map(
      (a) =>
        `<details><summary>${escape(a.id)}: ${a.verification?.completedChecks ?? 0} completed checks</summary><p>Artifact SHA-256: <code>${escape(a.verification?.artifactHash ?? "Unavailable")}</code></p>${a.verification?.checks.map((c) => `<h4>${escape(c.id)}: ${c.passed ? "pass" : "not passed"}</h4><p>Termination: ${escape(c.termination)}</p><p>${c.observation ? link(c.observation, "Raw verifier observation") : "Raw observation unavailable"}</p><pre>${escape(c.stdout)}</pre><pre>${escape(c.stderr)}</pre>`).join("") ?? "<p>No verifier receipt.</p>"}</details>`,
    )
    .join("");
  const sources = run.sources
    .map(
      (s) =>
        `<article><h3>${escape(s.declaredVersion || "Unspecified version")}: ${escape(s.status)}</h3><p>${escape(s.url)}</p><p>Final URL: ${escape(s.finalUrl)}<br>Recorded: ${escape(s.retrievedAt)}<br>Method: ${escape(s.method)}</p><p>${escape(s.excerpt)}</p><p>${s.artifact ? link(s.artifact, "Frozen source text") : "Source unavailable"}</p><code>${escape(s.contentSha256)}</code></article>`,
    )
    .join("");
  const old = spec.arms.some((a) => a.id === "A")
    ? "A is present. B versus C remains the primary comparison."
    : "Old model unavailable. A versus B upgrade-regression attribution is unavailable.";
  const difference =
    stats.difference === null
      ? "Incomplete comparison. No effect inference."
      : `B versus C descriptive difference: ${(stats.difference * 100).toFixed(1)} percentage points in verified success.`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'"><title>deadcodefix | Owned replay report</title>
<style>body{font:16px/1.6 system-ui,sans-serif;color:#172126;background:#f5f6f4;margin:0}main{max-width:1100px;margin:auto;padding:32px 24px}h1,h2,h3{line-height:1.25}h1{font-size:2.3rem}h2{margin-top:2.5rem}a{color:#075a70;text-underline-offset:3px}a:focus-visible,summary:focus-visible{outline:3px solid #a75400;outline-offset:4px}.notice,article,details{background:#fff;border:1px solid #bac5c7;padding:16px;margin:12px 0;border-radius:6px}.notice{border-left:5px solid #075a70}code,pre{font-family:ui-monospace,monospace;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#edf0ee;padding:12px}table{width:100%;border-collapse:collapse;background:#fff}th,td{text-align:left;border-bottom:1px solid #bac5c7;padding:10px;vertical-align:top}caption{text-align:left;font-weight:600;margin:8px 0}.table-scroll{overflow-x:auto}summary{cursor:pointer;font-weight:600}.meta{color:#465356}.skip{display:inline-block;margin:12px 24px}nav{display:flex;gap:18px;flex-wrap:wrap}footer{margin-top:40px;border-top:1px solid #bac5c7;padding-top:16px}</style></head>
<body><a class="skip" href="#results">Skip to results</a><main><header><p class="meta">deadcodefix / local evidence report</p><h1>Owned replay</h1><p>${escape(run.caseId)}</p><div class="notice"><strong>No live model improvement was measured.</strong><p>This report replays owned synthetic responses. Repeated records are not independent model trials. No provider calls or charges are represented.</p></div><nav aria-label="Report sections"><a href="#results">Main results</a><a href="#attempts">All attempts</a><a href="#sources">Sources</a><a href="#patch">Exact patch</a><a href="#verification">Verification</a></nav></header>
<section aria-labelledby="identity"><h2 id="identity">Pinned case</h2><p>Repository: <code>${escape(run.repoSHA)}</code><br>Repaired tree: <code>${escape(run.repairTree)}</code></p><p>${old}</p><p>${link(run.task, "Task")} · ${link(run.evidence, "Evidence packet")} · ${link(run.rehearsal, "Verifier rehearsal")}</p></section>
<section aria-labelledby="results"><h2 id="results" tabindex="-1">Main results: B versus C</h2><p>${difference}</p><p>Verified task success per planned main slot. Conservative completion counts unknown and not-run slots in the denominator; it does not estimate their correctness. Smoke and pilot outcomes are excluded.</p><div class="table-scroll"><table><caption>Main replay counts and descriptive Wilson 95% intervals</caption><thead><tr><th scope="col">Arm</th><th scope="col">Planned</th><th scope="col">Pass</th><th scope="col">Fail</th><th scope="col">Unknown</th><th scope="col">Not run</th><th scope="col">Completion</th><th scope="col">Interval</th></tr></thead><tbody>${counts}</tbody></table></div><p>Intervals exercise the report calculations on synthetic replay. They do not establish a live model effect or a confirmatory result.</p></section>
<section aria-labelledby="attempts"><h2 id="attempts">All attempts</h2><div class="table-scroll"><table><caption>Smoke, pilot and main receipts</caption><thead><tr><th scope="col">Slot</th><th scope="col">Phase</th><th scope="col">Outcome</th><th scope="col">Evidence</th><th scope="col">Reason</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<section aria-labelledby="sources"><h2 id="sources">Frozen sources</h2>${sources}<ul>${run.omissions.map((o) => `<li>${escape(o)}</li>`).join("")}</ul></section>
<section aria-labelledby="patch"><h2 id="patch">Exact evaluated patch</h2><p>${link(run.patch, "Open patch bytes")} · SHA-256: <code>${escape(run.patch.sha256)}</code></p><p>Prompt and code edits are evaluated as one repair package. No individual-edit attribution is established.</p><pre>${escape(patch)}</pre></section>
<section aria-labelledby="verification"><h2 id="verification">Independent artifact checks</h2><p>The supervisor compares exact outputs. Candidate pass claims do not determine outcomes.</p>${checks}</section><footer>Local replay evidence. Live evaluation, public release and external submission require separate qualification.</footer></main></body></html>`;
  const observations = run.attempts
    .flatMap((attempt) =>
      (attempt.verification?.checks ?? []).map((check) =>
        check.observation
          ? `- ${md(attempt.id)} / ${md(check.id)}: [Raw verifier observation](${check.observation.path})`
          : `- ${md(attempt.id)} / ${md(check.id)}: raw observation unavailable`,
      ),
    )
    .join("\n");
  const markdown = `# deadcodefix: owned replay\n\nNo live model improvement was measured. Owned synthetic replay only.\n\nCase: ${md(run.caseId)}\n\nRepository: ${run.repoSHA}\n\n${old}\n\n## Main results\n\n${difference}\n\n| Arm | Planned | Pass | Fail | Unknown | Not run |\n|---|---:|---:|---:|---:|---:|\n${Object.entries(
    stats.arms,
  )
    .map(
      ([arm, a]) =>
        `| ${arm} | ${a.planned} | ${a.pass} | ${a.fail} | ${a.unknown} | ${a.not_run} |`,
    )
    .join(
      "\n",
    )}\n\nSmoke and pilot are excluded. Repeated recordings do not establish a live effect.\n\n## All attempts\n\n${run.attempts.map((a) => `- ${md(a.id)}: ${a.disposition}. ${md(a.reason)}`).join("\n")}\n\n## Evidence\n\n[Exact patch](${run.patch.path}) · [Evidence packet](${run.evidence.path}) · [Verifier rehearsal](${run.rehearsal.path})\n\n${run.sources.map((s) => `- ${md(s.declaredVersion)}: ${s.status}. ${md(s.url)}${s.artifact ? ` [Frozen text](${s.artifact.path})` : ""}`).join("\n")}\n\n${run.omissions.map((o) => `- ${md(o)}`).join("\n")}\n`;
  return {
    html,
    markdown: markdown + "\n## Verifier observations\n\n" + observations + "\n",
    patch,
  };
}
