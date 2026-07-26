import { execFileSync } from "node:child_process";

const pnpmEntrypoint = process.env.npm_execpath;
if (!pnpmEntrypoint) {
  throw new Error("npm_execpath is unavailable; run this script through pnpm");
}
const roots = JSON.parse(
  execFileSync(
    process.execPath,
    [pnpmEntrypoint, "list", "-r", "--prod", "--depth", "Infinity", "--json"],
    { encoding: "utf8" },
  ),
);

const packages = new Map();
function visit(dependencies) {
  if (!dependencies || typeof dependencies !== "object") return;
  for (const [name, node] of Object.entries(dependencies)) {
    if (!node || typeof node !== "object") continue;
    if (typeof node.version === "string") {
      packages.set(`${name}@${node.version}`, { name, version: node.version });
    }
    visit(node.dependencies);
    visit(node.optionalDependencies);
  }
}
for (const root of roots) {
  visit(root.dependencies);
  visit(root.optionalDependencies);
}

const queries = [...packages.values()].map(({ name, version }) => ({
  package: { ecosystem: "npm", name },
  version,
}));

const accepted = new Map([
  [
    "react-router@7.18.1:GHSA-qwww-vcr4-c8h2",
    "RSC server-action CSRF is unreachable: PoPo is a static Vite/Tauri BrowserRouter client and has no React Server Components or server actions. OSV's listed fixed 8.3.0 release is not published.",
  ],
]);

const findings = [];
for (let offset = 0; offset < queries.length; offset += 500) {
  const batch = queries.slice(offset, offset + 500);
  const response = await fetch("https://api.osv.dev/v1/querybatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queries: batch }),
  });
  if (!response.ok) {
    throw new Error(`OSV query failed with HTTP ${response.status}`);
  }
  const body = await response.json();
  body.results.forEach((result, index) => {
    for (const vulnerability of result.vulns ?? []) {
      findings.push({ ...batch[index], id: vulnerability.id });
    }
  });
}

const unexpected = [];
for (const finding of findings) {
  const key = `${finding.package.name}@${finding.version}:${finding.id}`;
  const rationale = accepted.get(key);
  if (rationale) {
    console.warn(`ACCEPTED ${key}\n  ${rationale}`);
  } else {
    unexpected.push(key);
  }
}

console.log(`OSV scanned ${queries.length} unique resolved production npm packages.`);
if (unexpected.length > 0) {
  console.error("Unaccepted OSV findings:\n" + [...new Set(unexpected)].sort().join("\n"));
  process.exit(1);
}
console.log("No applicable known OSV vulnerabilities found.");
