// End-to-end test: real agent API + real MCP server + real Postgres, with a FAKE GitHub and a FAKE LLM.
// Run:  npm run e2e   (Postgres must be up and the schema applied)
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const agentDir = path.join(here, "..");
const STATE = path.join(os.tmpdir(), "fake-gh-state.json");
const README = `# Sandbox Utils\n\n## Instalation\n\nCopy src/utils.js. There is no package to instal.\n\n## Contributing\n\nPlease open an issue frist.\n`;
const resetGithub = (main = { "README.md": README }) => fs.writeFileSync(STATE, JSON.stringify({ main, branches: {}, prs: [] }));
const readGithub = () => JSON.parse(fs.readFileSync(STATE, "utf8"));

// ---- fake LLM (OpenAI-compatible) ----
let editCalls = 0;
let scenario = "typos"; // "typos" edits an existing file; "gitignore" creates a NEW file
let fail503 = 0; // when > 0, the fake LLM answers 503 this many times (simulates provider overload)
const llm = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    if (fail503 > 0) { fail503--; res.statusCode = 503; res.end(JSON.stringify([{ error: { code: 503, status: "UNAVAILABLE" } }])); return; }
    const sys = JSON.parse(b).messages[0].content;
    let out;
    if (sys.includes("choose which open-source issue")) out = { ranked: [{ number: 1, score: 0.99, reason: "tiny and clear" }] };
    else if (sys.includes("implementation plan")) out = { summary: "Plan", steps: ["edit"], filesLikelyTouched: scenario === "gitignore" ? [".gitignore"] : ["README.md"], risks: ["none"] };
    else if (sys.includes("draft a pull request")) out = { branchName: "fix/1-readme-typos", prTitle: "fix: README typos", prBody: "Closes #1\n- [ ] fix typos" };
    else if (sys.includes("propose minimal, exact file edits")) {
      editCalls++;
      if (scenario === "gitignore") out = { commitMessage: "chore: add .gitignore", edits: [{ path: ".gitignore", find: "", replace: "node_modules/\n.env\ndist/\n" }] };
      else out = editCalls === 1
        ? { commitMessage: "fix typos", edits: [{ path: "README.md", find: "TEXT THAT IS NOT THERE", replace: "x" }] } // forces the retry path
        : { commitMessage: "docs: fix README typos", edits: [
            { path: "README.md", find: "## Instalation", replace: "## Installation" },
            { path: "README.md", find: "to instal.", replace: "to install." },
            { path: "README.md", find: "issue frist.", replace: "issue first." } ] };
    } else out = {};
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }));
  });
});
await new Promise((r) => llm.listen(4999, r));

// ---- start the agent ----
const PORT = 4100, API = `http://localhost:${PORT}`;
const agent = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: agentDir,
  env: { ...process.env, PORT: String(PORT), GITHUB_MCP_FAKE: "1", FAKE_GH_STATE: STATE, LLM_PROVIDER: "openai", LLM_BASE_URL: "http://localhost:4999/v1",
    LLM_API_KEY: "x", LLM_RETRY_BASE_MS: "30", LLM_MODEL: "fake", ALLOW_GITHUB_WRITES: "true", WRITABLE_REPOS: "vvvvvvss/sandbox" },
});
let log = ""; agent.stdout.on("data", (d) => (log += d)); agent.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 60 && !log.includes("agent API on"); i++) await new Promise((r) => setTimeout(r, 500));
if (!log.includes("agent API on")) { console.error("agent did not start:\n" + log); process.exit(1); }

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + extra}`); if (!ok) failed++; };
const post = (p, body) => fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
const get = (p) => fetch(API + p).then((r) => r.json());

try {
  const REPO = "vvvvvvss/sandbox";

  resetGithub();
  const issues = await get(`/api/issues?repo=${REPO}`);
  check("lists and ranks issues", issues.length === 1 && issues[0].score > 0.9, JSON.stringify(issues));

  let plan = await (await post("/api/plan", { repo: REPO, issueNumber: 1 })).json();
  check("plan returns an approvalId (and LLM retry worked)", typeof plan.approvalId === "number" && editCalls === 2, JSON.stringify(plan) + " editCalls=" + editCalls);
  let pending = (await get("/api/approvals/pending")).find((a) => a.id === plan.approvalId);
  check("approval card has a diff of README.md", pending?.payload.changes?.[0]?.diff.includes("+## Installation"), JSON.stringify(pending));
  check("nothing pushed before approval", readGithub().prs.length === 0 && Object.keys(readGithub().branches).length === 0);

  let r = await post(`/api/approvals/${plan.approvalId}/approve`);
  let out = await r.json();
  let gh = readGithub();
  const branch = Object.keys(gh.branches)[0];
  check("approve -> executed with PR url", r.status === 200 && out.status === "executed" && out.prUrl?.endsWith("/pull/1"), JSON.stringify(out));
  check("branch has fixed README, main untouched", gh.branches[branch]?.["README.md"].includes("## Installation") && gh.main["README.md"].includes("Instalation"));
  check("exactly one PR", gh.prs.length === 1);

  r = await post(`/api/approvals/${plan.approvalId}/approve`);
  check("double approve is rejected (409) and opens no second PR", r.status === 409 && readGithub().prs.length === 1);

  // stale file: main changes after the plan was made
  plan = await (await post("/api/plan", { repo: REPO, issueNumber: 1 })).json();
  const s = readGithub(); s.main["README.md"] += "\nSomeone else edited this.\n"; fs.writeFileSync(STATE, JSON.stringify(s));
  r = await post(`/api/approvals/${plan.approvalId}/approve`); out = await r.json();
  check("stale file is refused, nothing overwritten", r.status === 502 && out.status === "failed" && /changed/.test(out.error) && readGithub().prs.length === 1, JSON.stringify(out));

  // provider overload: three 503s in a row must be retried transparently
  resetGithub(); fail503 = 3;
  plan = await (await post("/api/plan", { repo: REPO, issueNumber: 1 })).json();
  check("plan survives transient LLM 503s via retry", typeof plan.approvalId === "number" && fail503 === 0, JSON.stringify(plan));

  // reject
  resetGithub();
  plan = await (await post("/api/plan", { repo: REPO, issueNumber: 1 })).json();
  r = await post(`/api/approvals/${plan.approvalId}/reject`);
  check("reject works", (await r.json()).status === "rejected");
  r = await post(`/api/approvals/${plan.approvalId}/approve`);
  check("cannot approve after reject", r.status === 409 && readGithub().prs.length === 0);

  // creating a brand-new file (the real GitHub reports a missing file with its own wording)
  resetGithub(); scenario = "gitignore";
  plan = await (await post("/api/plan", { repo: REPO, issueNumber: 1 })).json();
  pending = (await get("/api/approvals/pending")).find((a) => a.id === plan.approvalId);
  check("new-file plan: .gitignore proposed as a new file", pending?.payload.changes?.[0]?.path === ".gitignore" && pending.payload.changes[0].isNew === true, JSON.stringify(plan));
  r = await post(`/api/approvals/${plan.approvalId}/approve`); out = await r.json();
  gh = readGithub();
  check("new file committed on the PR branch", out.status === "executed" && Object.values(gh.branches).some((b) => b[".gitignore"]?.includes("node_modules/")), JSON.stringify(out));
  scenario = "typos";

  const hist = await get("/api/history");
  check("audit log has executed + failed + rejected", ["executed", "failed", "rejected"].every((st) => hist.some((h) => h.status === st)));
} catch (e) {
  console.error(e); failed++;
} finally {
  agent.kill(); llm.close();
  console.log(failed ? `\n${failed} check(s) FAILED\n--- agent log ---\n${log.slice(-1500)}` : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
}
