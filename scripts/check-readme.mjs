import { readFileSync } from "node:fs";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

const required = ["## Compatibility", "## Runtime assumptions", "## Tools"];
const missing = required.filter((section) => !readme.includes(section));

if (readme.includes("swarm.loop")) {
  console.error("README still mentions swarm.loop");
  process.exit(1);
}

if (missing.length > 0) {
  console.error(`README missing sections: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("README checks passed");
