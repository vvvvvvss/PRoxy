import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../..");
dotenv.config({ path: path.join(ROOT, ".env") });

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/ghagent",
  githubToken: process.env.GITHUB_TOKEN ?? "",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  llmProvider: process.env.LLM_PROVIDER ?? "anthropic", // "anthropic" | "openai" (OpenAI-compatible)
  llmBaseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
  llmApiKey: process.env.LLM_API_KEY ?? "",
  // Safety switches for real GitHub writes (both default to OFF):
  allowWrites: process.env.ALLOW_GITHUB_WRITES === "true",
  writableRepos: (process.env.WRITABLE_REPOS ?? "").split(",").map((r) => r.trim().toLowerCase()).filter(Boolean),
  fakeGithub: process.env.GITHUB_MCP_FAKE === "1", // tests only
  retryBaseMs: Number(process.env.LLM_RETRY_BASE_MS ?? 1000), // backoff base; tests lower it
  fallbackModel: process.env.LLM_FALLBACK_MODEL ?? "", // optional: tried once if the main model stays overloaded
  model: process.env.LLM_MODEL ?? "claude-sonnet-5-5",
};
