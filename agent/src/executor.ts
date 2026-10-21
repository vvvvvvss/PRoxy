import { callGithub, getDefaultBranch, readFile, splitRepo } from "./github.js";
import { callMemory } from "./mcp.js";
import { env } from "./env.js";
import { sha, checkPath, type FileChange } from "./changes.js";

type Row = { id: number; repo: string; action: string; payload: any };
export type Outcome = { status: "approved" | "executed" | "failed"; prUrl?: string; note?: string; error?: string };

const findPrUrl = (r: unknown): string | undefined => {
  const o: any = r;
  if (o && typeof o === "object" && (o.html_url || o.url)) return String(o.html_url ?? o.url);
  return JSON.stringify(r).match(/https:\/\/github\.com\/[^\s"\\]+\/pull\/\d+/)?.[0];
};

/** Runs the exact, already-approved changes stored on the approval row. Never re-asks the LLM. */
export async function executeApproval(row: Row): Promise<Outcome> {
  if (row.action !== "open_pr") return { status: "approved", note: "Recorded only (not an executable action)." };
  if (!env.allowWrites) return { status: "approved", note: "Decision recorded. Real writes are OFF (set ALLOW_GITHUB_WRITES=true to enable)." };

  const steps: string[] = [];
  try {
    if (!env.writableRepos.includes(row.repo.toLowerCase()))
      throw new Error(`${row.repo} is not in WRITABLE_REPOS, so the agent will not push to it directly.`);
    const { branchName, base, prTitle, prBody, commitMessage } = row.payload;
    const changes: (FileChange & { newContent: string })[] = row.payload.changes;
    const { owner, repo } = splitRepo(row.repo);
    changes.forEach((c) => checkPath(c.path));

    // Refuse to overwrite anything that changed since the plan was made.
    const baseBranch = base ?? (await getDefaultBranch(row.repo));
    for (const c of changes) {
      const cur = await readFile(row.repo, c.path, baseBranch);
      if ((cur == null ? null : sha(cur)) !== c.originalHash)
        throw new Error(`${c.path} changed on ${baseBranch} since the plan was made. Re-plan to avoid overwriting newer work.`);
    }
    steps.push("verified files unchanged");

    await callGithub("create_branch", { owner, repo, branch: branchName, from_branch: baseBranch }, { approved: true });
    steps.push(`created branch ${branchName}`);

    await callGithub("push_files", {
      owner, repo, branch: branchName, message: commitMessage,
      files: changes.map((c) => ({ path: c.path, content: c.newContent })),
    }, { approved: true });
    steps.push("pushed commit");

    const pr = await callGithub("create_pull_request", { owner, repo, title: prTitle, body: prBody, head: branchName, base: baseBranch }, { approved: true });
    const prUrl = findPrUrl(pr);
    steps.push("opened pull request");

    await callMemory("log_approval", { id: row.id, status: "executed", result: { prUrl, steps } });
    return { status: "executed", prUrl };
  } catch (e: any) {
    const error = String(e.message ?? e);
    await callMemory("log_approval", { id: row.id, status: "failed", result: { error, completedSteps: steps } }).catch(() => {});
    return { status: "failed", error: steps.length ? `${error} (completed before failing: ${steps.join(", ")})` : error };
  }
}
