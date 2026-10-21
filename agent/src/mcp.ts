import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import path from "node:path";
import { ROOT, env } from "./env.js";

export let memory: Client;
export let github: Client | null = null;

/** Parse the first text block of an MCP tool result as JSON (falls back to raw text). */
export function parseResult(r: any): any {
  if (r?.isError) throw new Error(r.content?.[0]?.text ?? "MCP tool error");
  const t = r?.content?.find((c: any) => c.type === "text")?.text ?? "";
  try { return JSON.parse(t); } catch { return t; }
}

export async function connectAll() {
  // 1) our own MCP server, spawned as a child process over stdio.
  //    Run node directly (not npx) so it works the same on Windows and Linux.
  memory = new Client({ name: "agent-memory-client", version: "0.1.0" });
  await memory.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/index.ts"],
      cwd: path.join(ROOT, "server"),
      env: { ...(process.env as Record<string, string>), DATABASE_URL: env.databaseUrl },
    }),
  );
  console.log("memory MCP tools:", (await memory.listTools()).tools.map((t) => t.name));

  // 2) the official GitHub MCP server (hosted). Needs a token; skipped without one.
  if (env.fakeGithub) {
    // Tests only: an in-memory fake GitHub MCP server, so nothing real is touched.
    github = new Client({ name: "agent-github-client", version: "0.1.0" });
    await github.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", "test/fake-github.ts"],
        cwd: path.join(ROOT, "agent"),
        env: process.env as Record<string, string>,
      }),
    );
    console.log("FAKE github MCP connected");
  } else if (env.githubToken) {
    github = new Client({ name: "agent-github-client", version: "0.1.0" });
    await github.connect(
      new StreamableHTTPClientTransport(new URL("https://api.githubcopilot.com/mcp/"), {
        requestInit: { headers: { Authorization: `Bearer ${env.githubToken}` } },
      }),
    );
    // Print the real tool names once, so you can verify the ones used in github.ts.
    console.log("github MCP tools:", (await github.listTools()).tools.map((t) => t.name).join(", "));
  } else {
    console.warn("GITHUB_TOKEN not set: GitHub tools disabled");
  }
}

export const callMemory = async (name: string, args: Record<string, unknown>) =>
  parseResult(await memory.callTool({ name, arguments: args }));
