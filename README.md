# GitHub MCP Contribution Agent

## Run
    cp .env.example .env          # fill GITHUB_TOKEN and ANTHROPIC_API_KEY
    docker compose up -d          # Postgres (+pgvector), schema auto-applied
    cd server && npm install && npm test     # MCP server smoke test
    cd ../agent && npm install && npm run dev  # API on :4000 (spawns the MCP server itself)

The agent prints the real GitHub MCP tool names on startup. If list_issues / issue_read
differ from what github.ts uses, fix the names in agent/src/index.ts and agent/src/github.ts.

Layout: /server (MCP + DB), /agent (API + approval gate), /web (React UI), /docs

## Run the UI
    cd web && npm install && npm run dev      # http://localhost:5173 (proxies /api to :4000)
Keep the agent (`cd agent && npm run dev`) running in another terminal.

## Tests
    cd agent && npm run e2e     # full flow with a FAKE GitHub + FAKE LLM; needs Postgres up. Touches nothing real.
