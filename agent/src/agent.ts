import { z } from "zod";
import { completeJson, UNTRUSTED_NOTE } from "./llm.js";

export const RankSchema = z.object({
  ranked: z.array(z.object({ number: z.number(), score: z.number().min(0).max(1), reason: z.string() })),
});

export const PlanSchema = z.object({
  summary: z.string(),
  steps: z.array(z.string()),
  filesLikelyTouched: z.array(z.string()),
  risks: z.array(z.string()),
});

export const PrDraftSchema = z.object({
  branchName: z.string().regex(/^[a-z0-9][a-z0-9/_-]{2,60}$/),
  prTitle: z.string().max(100),
  prBody: z.string(),
});

export type IssueLite = { number: number; title: string; body?: string; labels: string[] };

export const rankIssues = (issues: IssueLite[]) =>
  completeJson(
    `You help a new contributor choose which open-source issue to tackle. ${UNTRUSTED_NOTE}
Score each issue 0-1: high = clearly described, small and self-contained, beginner-friendly, no heavy design debate.
Return {"ranked":[{"number":int,"score":number,"reason":"one short sentence"}]} for every issue.`,
    `<issues>${JSON.stringify(issues.map((i) => ({ ...i, body: (i.body ?? "").slice(0, 800) })))}</issues>`,
    RankSchema,
  );

export const makePlan = (issue: IssueLite) =>
  completeJson(
    `You write a short implementation plan for one GitHub issue. ${UNTRUSTED_NOTE}
Return {"summary":string,"steps":string[],"filesLikelyTouched":string[],"risks":string[]}. Be concrete and brief.`,
    `<issue>${JSON.stringify({ ...issue, body: (issue.body ?? "").slice(0, 4000) })}</issue>`,
    PlanSchema,
  );

export const draftPr = (issue: IssueLite, plan: z.infer<typeof PlanSchema>) =>
  completeJson(
    `You draft a pull request for an issue. Return {"branchName":string,"prTitle":string,"prBody":string}.
branchName: lowercase, hyphens, like "fix/123-short-description". prBody: what/why, mention "Closes #<number>", and a checklist of the intended changes written as UNCHECKED boxes ("- [ ] ..."): nothing has been done yet, so never tick a box.`,
    `<issue>${JSON.stringify({ number: issue.number, title: issue.title })}</issue><plan>${JSON.stringify(plan)}</plan>`,
    PrDraftSchema,
  );
