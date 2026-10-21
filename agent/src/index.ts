import express from "express";
import cors from "cors";
import { env } from "./env.js";
import { connectAll, callMemory } from "./mcp.js";
import { callGithub, getDefaultBranch, parseRepoUrl, splitRepo } from "./github.js";
import { proposeChanges } from "./changes.js";
import { executeApproval } from "./executor.js";
import { rankIssues, makePlan, draftPr, type IssueLite } from "./agent.js";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const wrap = (fn: express.RequestHandler): express.RequestHandler => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((e) => {
    console.error(e);
    res.status(500).json({ error: String(e.message ?? e) });
  });

const toLite = (i: any): IssueLite => ({
  number: i.number, title: i.title, body: i.body ?? "",
  labels: (i.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)),
});

const extractIssues = (r: any): any[] => (Array.isArray(r) ? r : r?.issues ?? r?.items ?? []);

app.post("/api/repos/connect", wrap(async (req, res) => {
  res.json({ repo: parseRepoUrl(String(req.body.repoUrl ?? "")) });
}));

// Fetch open issues -> rank with LLM -> return top few (and remember them in Postgres).
app.get("/api/issues", wrap(async (req, res) => {
  const repo = String(req.query.repo ?? "");
  const issues = extractIssues(
    await callGithub("list_issues", { ...splitRepo(repo), state: "OPEN", perPage: 20 }),
  ).map(toLite);
  if (!issues.length) return res.json([]);

  const { ranked } = await rankIssues(issues);
  const byNum = new Map(issues.map((i) => [i.number, i]));
  const top = ranked.filter((r) => byNum.has(r.number)).sort((a, b) => b.score - a.score).slice(0, 5);

  const out = [];
  for (const r of top) {
    const i = byNum.get(r.number)!;
    await callMemory("track_issue", { repo, issue_number: i.number, title: i.title, score: r.score, reason: r.reason });
    out.push({ number: i.number, title: i.title, labels: i.labels, score: r.score, reason: r.reason });
  }
  res.json(out);
}));

// Plan + proposed code changes (as diffs) for the chosen issue. Stops at a pending approval. Nothing is pushed here.
app.post("/api/plan", wrap(async (req, res) => {
  const { repo, issueNumber } = req.body as { repo: string; issueNumber: number };
  const issue = toLite(await callGithub("issue_read", { ...splitRepo(repo), issue_number: issueNumber, method: "get" }));
  const base = await getDefaultBranch(repo);
  const plan = await makePlan(issue);
  await callMemory("track_issue", { repo, issue_number: issueNumber, title: issue.title, status: "planned" });

  try {
    const [pr, proposal] = await Promise.all([draftPr(issue, plan), proposeChanges(repo, issue, plan, base)]);
    const suffix = Math.random().toString(36).slice(2, 6);
    const row = await callMemory("log_approval", {
      repo, issue_number: issueNumber, action: "open_pr",
      payload: { base, branchName: `${pr.branchName}-${suffix}`, prTitle: pr.prTitle, prBody: pr.prBody, commitMessage: proposal.commitMessage, changes: proposal.changes },
    });
    res.json({ ...plan, approvalId: row.id });
  } catch (e: any) {
    console.error("draft failed:", e);
    res.json({ ...plan, approvalId: null, draftError: `Could not draft code changes: ${String(e.message ?? e).slice(0, 300)}` });
  }
}));

const shape = (a: any) => ({
  id: a.id, action: a.action, status: a.status, repo: a.repo, issueNumber: a.issue_number,
  payload: {
    branchName: a.payload?.branchName ?? a.payload?.head,
    prTitle: a.payload?.prTitle ?? a.payload?.title,
    prBody: a.payload?.prBody ?? a.payload?.body,
    changes: (a.payload?.changes ?? []).map((c: any) => ({ path: c.path, isNew: c.isNew, diff: c.diff })),
  },
});

app.get("/api/approvals/pending", wrap(async (_req, res) => {
  const rows = await callMemory("list_history", { status: "pending", limit: 50 });
  res.json(Array.isArray(rows) ? rows.map(shape) : []);
}));

// claim_approval is atomic (pending -> approved), so a double click can never run the writes twice.
app.post("/api/approvals/:id/approve", wrap(async (req, res) => {
  const row = await callMemory("claim_approval", { id: Number(req.params.id), to: "approved" });
  if (row?.error) return res.status(409).json({ error: "This approval was already decided or does not exist." });
  const out = await executeApproval(row);
  res.status(out.status === "failed" ? 502 : 200).json(out);
}));

app.post("/api/approvals/:id/reject", wrap(async (req, res) => {
  const row = await callMemory("claim_approval", { id: Number(req.params.id), to: "rejected" });
  if (row?.error) return res.status(409).json({ error: "This approval was already decided or does not exist." });
  res.json({ status: "rejected" });
}));

app.get("/api/history", wrap(async (_req, res) => res.json(await callMemory("list_history", { limit: 50 }))));

await connectAll();
console.log(`GitHub writes: ${env.allowWrites ? "ENABLED for " + (env.writableRepos.join(", ") || "(no repos listed in WRITABLE_REPOS)") : "OFF"}`);
app.listen(env.port, () => console.log(`agent API on http://localhost:${env.port}`));
