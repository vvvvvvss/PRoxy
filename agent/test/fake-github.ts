// A tiny in-memory stand-in for the GitHub MCP server, used only by the e2e test.
// State lives in a JSON file so the test can inspect and tamper with it.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";

const STATE = process.env.FAKE_GH_STATE ?? "/tmp/fake-gh-state.json";
type State = { main: Record<string, string>; branches: Record<string, Record<string, string>>; prs: any[] };
const load = (): State => JSON.parse(fs.readFileSync(STATE, "utf8"));
const save = (s: State) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
const json = (o: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(o) }] });
const err = (m: string) => ({ isError: true, content: [{ type: "text" as const, text: m }] });

const server = new McpServer({ name: "fake-github", version: "0.0.1" });
const repoArgs = { owner: z.string(), repo: z.string() };

server.registerTool("get_me", { description: "me" }, async () => json({ login: "vvvvvvss" }));
server.registerTool("search_repositories", { description: "s", inputSchema: { query: z.string(), minimal_output: z.boolean().optional() } },
  async () => json({ items: [{ full_name: "vvvvvvss/sandbox", default_branch: "main" }] }));
server.registerTool("list_issues", { description: "l", inputSchema: { ...repoArgs, state: z.string().optional(), perPage: z.number().optional() } },
  async () => json({ issues: [{ number: 1, title: "Fix typos in README", body: "Typos: Instalation, instal, frist", labels: [{ name: "good first issue" }] }], totalCount: 1 }));
server.registerTool("issue_read", { description: "r", inputSchema: { ...repoArgs, issue_number: z.number(), method: z.string() } },
  async () => json({ number: 1, title: "Fix typos in README", body: "Typos: Instalation, instal, frist", labels: [{ name: "good first issue" }] }));

server.registerTool("get_file_contents", { description: "f", inputSchema: { ...repoArgs, path: z.string().optional(), ref: z.string().optional() } },
  async ({ path, ref }) => {
    const s = load();
    const branch = ref?.replace("refs/heads/", "") ?? "main";
    const tree = branch === "main" ? s.main : s.branches[branch];
    if (!tree || !(path! in tree)) return err("Failed to get file contents. The path does not point to a file or directory, or the file does not exist in the repository.");
    return { content: [
      { type: "text" as const, text: "successfully downloaded text file (SHA: abc123)" },
      { type: "resource" as const, resource: { uri: `repo://${path}`, mimeType: "text/plain", text: tree[path!] } },
    ] };
  });
server.registerTool("create_branch", { description: "b", inputSchema: { ...repoArgs, branch: z.string(), from_branch: z.string().optional() } },
  async ({ branch }) => {
    const s = load();
    if (s.branches[branch]) return err("Reference already exists");
    s.branches[branch] = { ...s.main }; save(s);
    return json({ ref: `refs/heads/${branch}` });
  });
server.registerTool("push_files", { description: "p", inputSchema: { ...repoArgs, branch: z.string(), message: z.string(), files: z.array(z.object({ path: z.string(), content: z.string() })) } },
  async ({ branch, files }) => {
    const s = load();
    if (!s.branches[branch]) return err("Branch not found");
    for (const f of files) s.branches[branch][f.path] = f.content;
    save(s); return json({ ok: true });
  });
server.registerTool("create_pull_request", { description: "c", inputSchema: { ...repoArgs, title: z.string(), head: z.string(), base: z.string(), body: z.string().optional() } },
  async ({ owner, repo, title, head, base }) => {
    const s = load();
    const number = s.prs.length + 1;
    s.prs.push({ number, title, head, base }); save(s);
    return json({ id: number, url: `https://github.com/${owner}/${repo}/pull/${number}` });
  });

await server.connect(new StdioServerTransport());
