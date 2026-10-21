import { useState } from "react";
import { api, type Approval, type Issue, type Outcome, type Plan } from "./api";

type Stage = "connect" | "shortlist" | "plan" | "approval" | "done";
const STEPS: { key: Stage; label: string }[] = [
  { key: "shortlist", label: "1. Shortlist" },
  { key: "plan", label: "2. Plan" },
  { key: "approval", label: "3. Approval" },
];

export default function App() {
  const [stage, setStage] = useState<Stage>("connect");
  const [repoInput, setRepoInput] = useState("");
  const [repo, setRepo] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selected, setSelected] = useState<Issue | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [decision, setDecision] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError("");
    try { await fn(); } catch (e: any) { setError(e.message ?? String(e)); } finally { setBusy(""); }
  };

  const connect = () =>
    run("Fetching and ranking open issues… (this takes a few seconds)", async () => {
      const { repo } = await api.connect(repoInput);
      const list = await api.issues(repo);
      setRepo(repo);
      setIssues(list);
      setStage("shortlist");
    });

  const choose = (issue: Issue) =>
    run("Writing a plan and drafting the PR… (10–20 seconds)", async () => {
      setSelected(issue);
      setStage("plan");
      setPlan(null);
      const p = await api.plan(repo, issue.number);
      const pending = await api.pending();
      setPlan(p);
      setApproval(pending.find((a) => a.id === p.approvalId) ?? null);
    });

  const decide = (kind: "approve" | "reject") =>
    run(kind === "approve" ? "Approving…" : "Rejecting…", async () => {
      if (!approval) return;
      try {
        const r = await (kind === "approve" ? api.approve(approval.id) : api.reject(approval.id));
        setDecision(r);
      } catch (e: any) {
        // A failed execution is still a recorded outcome: show it instead of leaving dead buttons.
        if (e.data?.status !== "failed") throw e;
        setDecision(e.data);
      }
      setStage("done");
    });

  const restart = () => {
    setStage("shortlist"); setSelected(null); setPlan(null); setApproval(null); setDecision(null); setError("");
  };

  const activeIdx = STEPS.findIndex((s) => s.key === (stage === "done" ? "approval" : stage));

  return (
    <div className="app">
      <header>
        <h1>Contribution Agent</h1>
        <p className="sub">Finds a good issue, plans the fix, drafts the PR. Nothing is pushed until you approve.</p>
      </header>

      {stage !== "connect" && (
        <nav className="steps">
          {STEPS.map((s, i) => (
            <span key={s.key} className={i === activeIdx ? "step active" : i < activeIdx ? "step done" : "step"}>{s.label}</span>
          ))}
          <span className="repo">{repo}</span>
        </nav>
      )}

      {error && <div className="error" role="alert">{error}</div>}
      {busy && <div className="busy"><span className="spinner" />{busy}</div>}

      {stage === "connect" && (
        <section className="card">
          <h2>Connect a repository</h2>
          <div className="row">
            <input
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && repoInput && !busy && connect()}
              placeholder="owner/name or https://github.com/owner/name"
              disabled={!!busy}
            />
            <button onClick={connect} disabled={!repoInput || !!busy}>Find issues</button>
          </div>
        </section>
      )}

      {stage === "shortlist" && (
        <section>
          <h2>Top issues for you</h2>
          {issues.length === 0 && !busy && <p className="muted">No open issues found in this repo.</p>}
          {issues.map((i) => (
            <article key={i.number} className="card issue">
              <div className="issue-head">
                <h3>#{i.number} {i.title}</h3>
                <span className="score" title="Agent's fit score">{Math.round(i.score * 100)}%</span>
              </div>
              <div className="bar"><div style={{ width: `${i.score * 100}%` }} /></div>
              <p className="reason">{i.reason}</p>
              <div className="row spread">
                <div>{i.labels.map((l) => <span key={l} className="tag">{l}</span>)}</div>
                <button onClick={() => choose(i)} disabled={!!busy}>Plan this</button>
              </div>
            </article>
          ))}
        </section>
      )}

      {stage === "plan" && selected && (
        <section>
          <h2>Plan for #{selected.number}: {selected.title}</h2>
          {plan && (
            <>
              {plan.draftError && (
                <div className="error" role="alert">
                  {plan.draftError}
                  <div><button className="ghost" onClick={() => selected && choose(selected)} disabled={!!busy}>Try again</button></div>
                </div>
              )}
              <div className="card">
                <h3>Summary</h3>
                <p>{plan.summary}</p>
                <h3>Steps</h3>
                <ol>{plan.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                <h3>Files likely touched</h3>
                <p>{plan.filesLikelyTouched.map((f) => <code key={f} className="file">{f}</code>)}</p>
                <h3>Risks</h3>
                <ul>{plan.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
              <div className="row spread">
                <button className="ghost" onClick={restart}>← Back to shortlist</button>
                <button onClick={() => setStage("approval")} disabled={!approval}>Review proposed changes →</button>
              </div>
            </>
          )}
        </section>
      )}

      {stage === "approval" && approval && (
        <section>
          <h2>Approve this action?</h2>
          <div className="card approval">
            <div className="pill">Pending approval · {approval.action}</div>
            <dl>
              <dt>Repository</dt><dd>{approval.repo}</dd>
              <dt>Branch</dt><dd><code>{approval.payload.branchName}</code></dd>
              <dt>PR title</dt><dd>{approval.payload.prTitle}</dd>
              <dt>PR description</dt><dd><pre>{approval.payload.prBody}</pre></dd>
              <dt>Code changes ({approval.payload.changes?.length ?? 0} file(s))</dt>
              <dd>{(approval.payload.changes ?? []).map((c) => (
                <div key={c.path} className="diff">
                  <div className="diff-head">{c.path}{c.isNew && <span className="tag">new file</span>}</div>
                  <pre>{c.diff.split("\n").slice(3).map((line, i) => (
                    <span key={i} className={line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : line.startsWith("@@") ? "hunk" : ""}>{line + "\n"}</span>
                  ))}</pre>
                </div>
              ))}</dd>
            </dl>
            <p className="notice">Approving will create this branch, commit these exact changes and open the pull request. Nothing happens until you click Approve.</p>
            <div className="row spread">
              <button className="ghost" onClick={() => setStage("plan")} disabled={!!busy}>← Back</button>
              <div className="row">
                <button className="danger" onClick={() => decide("reject")} disabled={!!busy}>Reject</button>
                <button onClick={() => decide("approve")} disabled={!!busy}>Approve</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {stage === "done" && decision && (
        <section className="card center">
          <h2>
            {decision.status === "executed" ? "Pull request opened ✓" :
             decision.status === "approved" ? "Approved ✓" :
             decision.status === "failed" ? "Could not open the PR" : "Rejected"}
          </h2>
          {decision.prUrl && <p><a href={decision.prUrl} target="_blank" rel="noreferrer">{decision.prUrl}</a></p>}
          {decision.note && <p className="muted">{decision.note}</p>}
          {decision.error && <div className="error" role="alert">{decision.error}</div>}
          <p className="muted">Saved to the audit log (status: {decision.status}).</p>
          <button onClick={restart}>Pick another issue</button>
        </section>
      )}
    </div>
  );
}
