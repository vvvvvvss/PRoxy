import { github, callMemory, parseResult } from "./mcp.js";

/**
 * THE APPROVAL GATE (fail-closed).
 * Only tools on this read-only allowlist run immediately. EVERYTHING else, including any
 * tool GitHub adds later, is stored as a pending approval and needs a human to approve it.
 * (Week 2: the approve endpoint calls callGithub with approved=true.)
 */
export const READ_TOOLS = new Set([
  "get_me", "get_file_contents", "issue_read", "list_issues", "list_branches", "list_commits",
  "list_pull_requests", "pull_request_read", "list_repository_collaborators", "get_commit",
  "get_label", "get_latest_release", "list_releases", "get_tag", "list_tags",
  "search_code", "search_commits", "search_issues", "search_pull_requests",
  "search_repositories", "search_users",
]);

export const needsApproval = (tool: string) => !READ_TOOLS.has(tool);

export async function callGithub(
  name: string,
  args: Record<string, unknown>,
  opts: { approved?: boolean; repo?: string; issueNumber?: number } = {},
) {
  if (!github) throw new Error("GitHub MCP not connected (set GITHUB_TOKEN)");
  if (needsApproval(name) && !opts.approved) {
    const row = await callMemory("log_approval", {
      repo: opts.repo ?? `${args.owner}/${args.repo}`,
      issue_number: opts.issueNumber,
      action: name,
      payload: args,
    });
    return { pending: true, approvalId: row.id };
  }
  return parseResult(await github.callTool({ name, arguments: args }));
}

export const splitRepo = (repo: string) => {
  const [owner, name] = repo.split("/");
  return { owner, repo: name };
};

export function parseRepoUrl(input: string): string {
  const m = input.trim().match(/(?:github\.com[/:])?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error("Could not parse repo, expected owner/name or a GitHub URL");
  return `${m[1]}/${m[2]}`;
}

/** Read a file's text from a repo. Returns null ONLY if it does not exist; other errors throw. */
export async function readFile(repo: string, filePath: string, branch?: string): Promise<string | null> {
  if (!github) throw new Error("GitHub MCP not connected");
  const r: any = await github.callTool({
    name: "get_file_contents",
    arguments: { ...splitRepo(repo), path: filePath, ...(branch ? { ref: `refs/heads/${branch}` } : {}) },
  });
  const blocks: any[] = r.content ?? [];
  const firstText = blocks.find((b) => b.type === "text")?.text ?? "";
  if (r.isError) {
    // GitHub's real wording: "...the path does not point to a file or directory, or the file does not exist in the repository."
    if (/not found|404|does not exist|no such file|path does not point/i.test(firstText)) return null;
    throw new Error(`get_file_contents failed for ${filePath}: ${firstText.slice(0, 200)}`);
  }
  const res = blocks.find((b) => b.type === "resource" && typeof b.resource?.text === "string");
  if (res) return res.resource.text;
  try {
    const j = JSON.parse(firstText);
    if (typeof j?.content === "string" && j.encoding === "base64") return Buffer.from(j.content, "base64").toString("utf8");
    return null; // directory listing or binary: not editable text
  } catch {
    return firstText.startsWith("successfully downloaded") ? null : firstText;
  }
}

export async function getDefaultBranch(repo: string): Promise<string> {
  try {
    const r = await callGithub("search_repositories", { query: `repo:${repo}`, minimal_output: false });
    const item = (r?.items ?? r?.repositories ?? [])[0];
    return item?.default_branch ?? item?.defaultBranch ?? "main";
  } catch {
    return "main";
  }
}
