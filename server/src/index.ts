import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pool } from "./db.js";

const server = new McpServer({ name: "contribution-memory", version: "0.1.0" });

const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

server.registerTool(
  "track_issue",
  {
    description: "Start tracking a GitHub issue (or update its score/status).",
    inputSchema: {
      repo: z.string().describe("owner/name"),
      issue_number: z.number().int(),
      title: z.string(),
      status: z.enum(["tracking", "planned", "pr_opened", "dropped"]).default("tracking"),
      score: z.number().optional(),
      reason: z.string().optional(),
    },
  },
  async ({ repo, issue_number, title, status, score, reason }) => {
    const { rows } = await pool.query(
      `INSERT INTO tracked_issues (repo, issue_number, title, status, score, reason)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (repo, issue_number) DO UPDATE
         SET title=EXCLUDED.title, status=EXCLUDED.status,
             score=COALESCE(EXCLUDED.score, tracked_issues.score),
             reason=COALESCE(EXCLUDED.reason, tracked_issues.reason)
       RETURNING *`,
      [repo, issue_number, title, status, score ?? null, reason ?? null],
    );
    return text(rows[0]);
  },
);

server.registerTool(
  "save_repo_note",
  {
    description: "Save a short note about a repo (how to run tests, PR expectations, etc.).",
    inputSchema: { repo: z.string(), note: z.string().max(2000) },
  },
  async ({ repo, note }) => {
    const { rows } = await pool.query(
      `INSERT INTO repo_notes (repo, note) VALUES ($1,$2) RETURNING *`,
      [repo, note],
    );
    return text(rows[0]);
  },
);

server.registerTool(
  "list_history",
  {
    description: "List past approvals (audit log), newest first.",
    inputSchema: {
      repo: z.string().optional(),
      status: z.enum(["pending", "approved", "rejected", "executed", "failed"]).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    },
  },
  async ({ repo, status, limit }) => {
    const { rows } = await pool.query(
      `SELECT * FROM approvals WHERE ($1::text IS NULL OR repo=$1) AND ($2::text IS NULL OR status=$2)
       ORDER BY created_at DESC LIMIT $3`,
      [repo ?? null, status ?? null, limit],
    );
    return text(rows);
  },
);

server.registerTool(
  "log_approval",
  {
    description:
      "Record an approval decision. Creates a pending row if no id is given; otherwise updates status.",
    inputSchema: {
      id: z.number().int().optional(),
      repo: z.string().optional(),
      issue_number: z.number().int().optional(),
      action: z.string().optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
      status: z.enum(["pending", "approved", "rejected", "executed", "failed"]).default("pending"),
      result: z.record(z.string(), z.unknown()).optional(),
    },
  },
  async ({ id, repo, issue_number, action, payload, status, result }) => {
    if (id) {
      const { rows } = await pool.query(
        `UPDATE approvals SET status=$2, result=COALESCE($3::jsonb, result),
           decided_at = CASE WHEN $2 IN ('approved','rejected') THEN now() ELSE decided_at END
         WHERE id=$1 RETURNING *`,
        [id, status, result ? JSON.stringify(result) : null],
      );
      return text(rows[0] ?? { error: "approval not found" });
    }
    if (!repo || !action || !payload) {
      return { isError: true, content: [{ type: "text" as const, text: "repo, action and payload are required to create an approval" }] };
    }
    const { rows } = await pool.query(
      `INSERT INTO approvals (repo, issue_number, action, payload, status)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [repo, issue_number ?? null, action, JSON.stringify(payload), status],
    );
    return text(rows[0]);
  },
);

server.registerTool(
  "get_approval",
  { description: "Fetch one approval row by id.", inputSchema: { id: z.number().int() } },
  async ({ id }) => {
    const { rows } = await pool.query(`SELECT * FROM approvals WHERE id=$1`, [id]);
    return text(rows[0] ?? { error: "approval not found" });
  },
);

server.registerTool(
  "claim_approval",
  {
    description:
      "Atomically move a PENDING approval to approved/rejected. Returns {error} if it was not pending (already decided). Prevents double execution.",
    inputSchema: { id: z.number().int(), to: z.enum(["approved", "rejected"]) },
  },
  async ({ id, to }) => {
    const { rows } = await pool.query(
      `UPDATE approvals SET status=$2, decided_at=now() WHERE id=$1 AND status='pending' RETURNING *`,
      [id, to],
    );
    return text(rows[0] ?? { error: "not pending" });
  },
);

await server.connect(new StdioServerTransport());
