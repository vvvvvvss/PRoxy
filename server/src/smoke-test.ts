import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/index.ts"], env: { ...process.env as Record<string,string> } }));

console.log("tools:", (await client.listTools()).tools.map((t) => t.name));
const call = async (name: string, args: Record<string, unknown>) => {
  const r: any = await client.callTool({ name, arguments: args });
  console.log(`\n${name} ->`, r.content[0].text.slice(0, 300));
  return r;
};

await call("track_issue", { repo: "me/sandbox", issue_number: 1, title: "Fix typo in README", score: 0.9, reason: "tiny, clear" });
await call("save_repo_note", { repo: "me/sandbox", note: "Run tests with npm test" });
const a = await call("log_approval", { repo: "me/sandbox", issue_number: 1, action: "open_pr", payload: { branch: "fix/readme-typo", title: "Fix typo" } });
const id = JSON.parse(a.content[0].text).id;
await call("log_approval", { id, status: "approved" });
await call("list_history", { repo: "me/sandbox" });
await client.close();
