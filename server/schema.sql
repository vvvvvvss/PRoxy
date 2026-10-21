CREATE TABLE IF NOT EXISTS tracked_issues (
  id          SERIAL PRIMARY KEY,
  repo        TEXT NOT NULL,
  issue_number INT NOT NULL,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'tracking',  -- tracking | planned | pr_opened | dropped
  score       REAL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repo, issue_number)
);

CREATE TABLE IF NOT EXISTS repo_notes (
  id         SERIAL PRIMARY KEY,
  repo       TEXT NOT NULL,
  note       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approvals (
  id          SERIAL PRIMARY KEY,
  repo        TEXT NOT NULL,
  issue_number INT,
  action      TEXT NOT NULL,            -- e.g. open_pr
  payload     JSONB NOT NULL,           -- branch name, PR title/body, diff...
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | executed | failed
  result      JSONB,                    -- PR url or error
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at  TIMESTAMPTZ
);
