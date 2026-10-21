# API contract (frozen for prototype)  - agent backend on http://localhost:4000

POST /api/repos/connect          { repoUrl }                 -> { repo: "owner/name" }
GET  /api/issues?repo=owner/name -> [{ number, title, labels, score, reason }]   (top 5, ranked)
POST /api/plan                   { repo, issueNumber }       -> { summary, steps[], filesLikelyTouched[], risks[], approvalId }
GET  /api/approvals/pending      -> [{ id, action, status, repo, issueNumber, payload:{ branchName, prTitle, prBody } }]
POST /api/approvals/:id/approve  -> { status: "approved" }   (prototype: records only, never pushes)
POST /api/approvals/:id/reject   -> { status: "rejected" }
GET  /api/history                -> approvals audit log, newest first
