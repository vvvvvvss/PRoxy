// Usage: node scripts/seed-sandbox.mjs OWNER/REPO [--dry]
// Reads GITHUB_TOKEN from ../.env. Needs Contents: write and Issues: write on that repo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [repo, flag] = process.argv.slice(2);
const dry = flag === "--dry";
if (!repo?.includes("/")) { console.error("Usage: node scripts/seed-sandbox.mjs OWNER/REPO [--dry]"); process.exit(1); }

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, "..", ".env");
const env = Object.fromEntries(
  (fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "")
    .split(/\r?\n/).map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*([^#\s]*)/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const token = env.GITHUB_TOKEN || process.env.GITHUB_TOKEN;
if (!token && !dry) { console.error("GITHUB_TOKEN missing in .env"); process.exit(1); }

const api = async (method, url, body) => {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "sandbox-seeder" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && method === "GET") return null;
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}`);
  return res.json();
};

const files = {
  "README.md": `# Sandbox Utils

A tiny collection of string helpers used for testing the contribution agent.

## Instalation

Copy \`src/utils.js\` into your project. There is no package to instal.

## Usage

\`\`\`js
import { capitalize, slugify } from "./src/utils.js";
capitalize("hello");      // "Hello"
slugify("Hello World");   // "hello-world"
\`\`\`

## Contributing

Pull requests are welcome. Please open an issue frist.
`,
  "src/utils.js": `export function capitalize(str) {
  return str[0].toUpperCase() + str.slice(1);
}

export function slugify(str) {
  return str.trim().toLowerCase().replace(/\\s+/g, "-");
}

export function parseLines(text) {
  return text.split("\\n").filter(Boolean);
}

export function loadConfig(path) {
  return JSON.parse(require("fs").readFileSync(path, "utf8"));
}
`,
  "package.json": JSON.stringify({ name: "sandbox-utils", version: "0.1.0", type: "module", scripts: { test: "echo \"no tests yet\" && exit 0" } }, null, 2) + "\n",
};

const issues = [
  ["Fix typos in README", "The README has a few typos: \"Instalation\", \"instal\" and \"frist\". Please fix them all.", ["good first issue", "documentation"]],
  ["Add a .gitignore", "The repo has no `.gitignore`. Please add one that ignores `node_modules/`, `.env` and `dist/`.", ["good first issue"]],
  ["slugify crashes or misbehaves on special characters", "`slugify(\"Hello, World!\")` returns `\"hello,-world!\"`. Expected `\"hello-world\"`. Punctuation should be removed. Please fix in `src/utils.js` and add a couple of examples to the README.", ["bug"]],
  ["capitalize throws on empty string", "`capitalize(\"\")` throws `TypeError: Cannot read properties of undefined`. It should return an empty string instead.", ["bug", "good first issue"]],
  ["Add unit tests for capitalize and slugify", "There are no tests. Please add tests (Node's built-in `node:test` is fine) covering normal input, empty strings and extra whitespace, and make `npm test` run them.", ["enhancement"]],
  ["Document how to run tests in CONTRIBUTING.md", "Add a short `CONTRIBUTING.md` explaining how to set up the project, run tests and open a pull request.", ["documentation", "good first issue"]],
  ["Better error when config file is missing", "`loadConfig` throws a raw ENOENT error that is confusing. Wrap it so the message says which path was not found. Also note `require` is used in an ES module file, which looks wrong.", ["bug"]],
  ["it doesnt work", "tried it and it broke. please fix asap", []],
  ["Add dark mode", "It would be nice to have dark mode.", ["enhancement"]],
  ["Rewrite the whole library in TypeScript with a plugin system and full docs site", "We should migrate everything to TypeScript, design a plugin architecture, set up CI/CD, publish to npm, build a documentation website and add benchmarks. Needs discussion on the design first.", ["enhancement"]],
];

console.log(`${dry ? "[dry run] " : ""}Seeding ${repo}: ${Object.keys(files).length} files, ${issues.length} issues`);
if (dry) { issues.forEach(([t], i) => console.log(` ${i + 1}. ${t}`)); process.exit(0); }

for (const [p, content] of Object.entries(files)) {
  const existing = await api("GET", `/repos/${repo}/contents/${p}`);
  await api("PUT", `/repos/${repo}/contents/${p}`, {
    message: `Seed ${p}`, content: Buffer.from(content).toString("base64"), ...(existing ? { sha: existing.sha } : {}),
  });
  console.log("wrote", p);
}
for (const [title, body, labels] of issues) {
  const r = await api("POST", `/repos/${repo}/issues`, { title, body, labels });
  console.log(`issue #${r.number}: ${title}`);
}
console.log("Done. Open https://github.com/" + repo + "/issues");
