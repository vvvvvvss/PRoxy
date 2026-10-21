export type Issue = { number: number; title: string; labels: string[]; score: number; reason: string };
export type Plan = { summary: string; steps: string[]; filesLikelyTouched: string[]; risks: string[]; approvalId: number | null; draftError?: string };
export type Approval = {
  id: number; action: string; status: string; repo: string; issueNumber?: number;
  payload: { branchName?: string; prTitle?: string; prBody?: string; changes?: { path: string; isNew: boolean; diff: string }[] };
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as any).error ?? `Request failed (${res.status})`), { data });
  return data as T;
}

export type Outcome = { status: string; prUrl?: string; note?: string; error?: string };

export const api = {
  connect: (repoUrl: string) => call<{ repo: string }>("/api/repos/connect", { method: "POST", body: JSON.stringify({ repoUrl }) }),
  issues: (repo: string) => call<Issue[]>(`/api/issues?repo=${encodeURIComponent(repo)}`),
  plan: (repo: string, issueNumber: number) => call<Plan>("/api/plan", { method: "POST", body: JSON.stringify({ repo, issueNumber }) }),
  pending: () => call<Approval[]>("/api/approvals/pending"),
  approve: (id: number) => call<Outcome>(`/api/approvals/${id}/approve`, { method: "POST" }),
  reject: (id: number) => call<{ status: string }>(`/api/approvals/${id}/reject`, { method: "POST" }),
};
