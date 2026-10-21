import { createTwoFilesPatch } from "diff";
import { createHash } from "node:crypto";
import { z } from "zod";
import { completeJson, UNTRUSTED_NOTE } from "./llm.js";
import { readFile } from "./github.js";
import type { IssueLite, PlanSchema } from "./agent.js";

export type FileChange = { path: string; isNew: boolean; originalHash: string | null; newContent: string; diff: string };

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// The agent may never touch CI config, secrets or git internals, whatever the model says.
const BLOCKED = [/^\.github\/workflows\//i, /(^|\/)\.env/i, /(^|\/)\.git(\/|$)/, /\.(pem|key|p12)$/i];
export function checkPath(p: string) {
  if (!p || p.includes("..") || p.startsWith("/") || p.includes("\\") || BLOCKED.some((r) => r.test(p)))
    throw new Error(`Refusing to modify protected or invalid path: ${p}`);
}

const MAX_FILES = 4;
const MAX_FILE_CHARS = 20_000;

const EditsSchema = z.object({
  commitMessage: z.string().min(3).max(120),
  edits: z.array(z.object({ path: z.string(), find: z.string(), replace: z.string() })).min(1).max(10),
});

type Loaded = Map<string, string | null>; // path -> current content (null = does not exist yet)

function applyEdits(v: z.infer<typeof EditsSchema>, files: Loaded) {
  const working = new Map(files);
  for (const e of v.edits) {
    checkPath(e.path);
    if (!files.has(e.path)) throw new Error(`Edit targets ${e.path}, which is not one of the provided files`);
    const cur = working.get(e.path);
    if (cur == null) {
      if (e.find !== "") throw new Error(`${e.path} does not exist yet: use find "" and put the full file in replace`);
      working.set(e.path, e.replace);
      continue;
    }
    if (e.find === "") throw new Error(`${e.path} already exists: "find" must be an exact snippet of its current content`);
    const eol = cur.includes("\r\n") ? "\r\n" : "\n";
    const find = e.find.replace(/\r?\n/g, eol);
    const replace = e.replace.replace(/\r?\n/g, eol);
    const count = cur.split(find).length - 1;
    if (count !== 1) throw new Error(`In ${e.path}, "find" text must match exactly once but matched ${count} times: ${JSON.stringify(e.find.slice(0, 80))}`);
    working.set(e.path, cur.replace(find, () => replace));
  }
  const changes: FileChange[] = [];
  for (const [p, next] of working) {
    const prev = files.get(p) ?? null;
    if (next == null || next === prev) continue;
    changes.push({
      path: p, isNew: prev == null, originalHash: prev == null ? null : sha(prev), newContent: next,
      diff: createTwoFilesPatch(prev == null ? "/dev/null" : `a/${p}`, `b/${p}`, prev ?? "", next, "", "", { context: 3 }),
    });
  }
  if (!changes.length) throw new Error("The edits produced no actual change");
  return { commitMessage: v.commitMessage, changes };
}

/** Read the files named in the plan, ask the model for minimal exact edits, validate them, compute diffs. */
export async function proposeChanges(repo: string, issue: IssueLite, plan: z.infer<typeof PlanSchema>, base: string) {
  const paths = [...new Set(plan.filesLikelyTouched.map((p) => p.trim().replace(/^\.?\//, "")))]
    .filter((p) => { try { checkPath(p); return true; } catch { return false; } })
    .slice(0, MAX_FILES);
  if (!paths.length) throw new Error("The plan named no editable files");

  const files: Loaded = new Map();
  for (const p of paths) {
    const content = await readFile(repo, p, base);
    if (content != null && content.length > MAX_FILE_CHARS) continue; // too big to edit safely
    files.set(p, content);
  }
  if (!files.size) throw new Error("All candidate files were too large to edit");

  const schema = EditsSchema.transform((v) => applyEdits(v, files));
  return completeJson(
    `You propose minimal, exact file edits that resolve one GitHub issue. ${UNTRUSTED_NOTE}
Return {"commitMessage":string,"edits":[{"path":string,"find":string,"replace":string}]}.
Rules: only use the provided paths. For an existing file, "find" must be an exact snippet copied verbatim from its current content and must appear exactly once; "replace" is its replacement. For a file that does not exist yet ("exists":false), use find "" and put the whole new file in "replace". Keep changes as small as possible. Never touch CI, secrets or unrelated files.`,
    `<issue>${JSON.stringify({ number: issue.number, title: issue.title, body: (issue.body ?? "").slice(0, 3000) })}</issue>
<plan>${JSON.stringify(plan)}</plan>
<files>${JSON.stringify([...files].map(([path, content]) => ({ path, exists: content != null, content: content ?? "" })))}</files>`,
    schema,
  );
}
