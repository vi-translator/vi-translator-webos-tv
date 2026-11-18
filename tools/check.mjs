// Checks that the code parses on the oldest TVs this app runs on (webOS 5: Chromium 68, Node.js 8.12):
// - app/js: ES2018 at most (Chromium 68 has it; no optional chaining, no ??, no class fields);
// - service: ES2017 at most (Node.js 8.12);
// - and, when the desktop app's repo is next to this one, its TV page (ui/tv.html, ui/common.js),
//   which the TV loads from the PC: the same limit, or it won't draw on webOS 5 and 6.
//
//   node tools/check.mjs [path to the desktop repo]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import * as acorn from "acorn";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/** the newest JavaScript webOS 5 runs: Chromium 68 for web pages, Node.js 8.12 for services */
const WEB = 2018;
const NODE = 2017;
let failed = false;

function check(name, code, es = WEB) {
  try {
    acorn.parse(code, { ecmaVersion: es, sourceType: "script" });
    console.log(`ok    ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL  ${name}: ${e.message} (newer than ES${es}: webOS 5 can't run it)`);
  }
}

for (const f of readdirSync(join(root, "app", "js")).filter((f) => f.endsWith(".js"))) {
  check(`app/js/${f}`, readFileSync(join(root, "app", "js", f), "utf8"));
}
check("service/service.js", readFileSync(join(root, "service", "service.js"), "utf8"), NODE);

const desktop = process.argv[2] || join(homedir(), "RustroverProjects", "vi-translator-desktop");
if (existsSync(join(desktop, "ui", "tv.html"))) {
  const html = readFileSync(join(desktop, "ui", "tv.html"), "utf8");
  let n = 0;
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) check(`desktop ui/tv.html (script ${++n})`, m[1]);
  check("desktop ui/common.js", readFileSync(join(desktop, "ui", "common.js"), "utf8"));
} else {
  console.log(`(no desktop repo at ${desktop}: its TV page isn't checked)`);
}

const appinfo = JSON.parse(readFileSync(join(root, "app", "appinfo.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (appinfo.version !== pkg.version) {
  failed = true;
  console.log(`FAIL  app/appinfo.json version ${appinfo.version} isn't package.json's ${pkg.version}`);
}

process.exit(failed ? 1 : 0);
