// Packages the app and its service into dist/vi-translator-webos-tv-<version>.ipk, with LG's ares-package.
//
//   node tools/build.mjs                       build
//   node tools/build.mjs --install [device]    build, then install and open it on the TV set up with
//                                              ares-setup-device (the default device if none is given)
//
// The window is "defaultWindowType": "overlay" (app/appinfo.json): undocumented by LG, but accepted by
// ares-package and by webOS 5 and newer. ("topui", which some webOS 25 apps use, is refused by
// ares-package and by webOS 5.)
import { readFileSync, mkdirSync, rmSync, readdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/** an LG ares tool (from @webos-tools/cli), run with this Node.js */
const run = (name, args) =>
  execFileSync(process.execPath, [join(root, "node_modules", "@webos-tools", "cli", "bin", `${name}.js`), ...args], { cwd: root, encoding: "utf8" });

const appinfo = JSON.parse(readFileSync(join(root, "app", "appinfo.json"), "utf8"));
const dist = join(root, "dist");
const out = join(root, "build");

rmSync(out, { recursive: true, force: true });
rmSync(dist, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(dist, { recursive: true });

// (not minified: readable when inspected on the TV with ares-inspect)
run("ares-package", ["--no-minify", join(root, "app"), join(root, "service"), "-o", out]);
const ipk = readdirSync(out).find((f) => f.endsWith(".ipk"));
const name = `vi-translator-webos-tv-${appinfo.version}.ipk`;
renameSync(join(out, ipk), join(dist, name));
console.log(`dist/${name}`);

const i = process.argv.indexOf("--install");
if (i >= 0) {
  const device = process.argv[i + 1];
  const d = device ? ["-d", device] : [];
  console.log(run("ares-device", ["--system-info", ...d]).trim());
  console.log(run("ares-install", [...d, join("dist", name)]).trim());
  console.log(run("ares-launch", [...d, appinfo.id]).trim());
}
