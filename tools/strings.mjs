// Makes app/js/strings.js: the screen's strings in every language, taken from the Android TV app's
// res/values*/strings.xml (already translated there) plus tools/extra-strings.json (the webOS-only ones).
//
//   node tools/strings.mjs [path to the Android repo]   (default: ../../AndroidStudioProjects/vi-translator-android-tv)
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const android = process.argv[2] || join(homedir(), "AndroidStudioProjects", "vi-translator-android-tv");
const res = join(android, "app", "src", "main", "res");
if (!existsSync(res)) {
  console.error(`No Android resources at ${res}`);
  process.exit(1);
}

/** the strings this app shows */
const KEYS = ["enter_code", "where_on_pc", "this_tv", "connected_to", "looking_for", "overlays_off", "show_on", "all_inputs", "disconnect", "language", "language_tv"];

/** "values-b+es+419" → "es-419", "values-zh-rTW" → "zh-TW", "values-in" → "id", "values" → "en" */
function locale(dir) {
  if (dir === "values") return "en";
  let s = dir.slice("values-".length);
  if (s.startsWith("b+")) s = s.slice(2).split("+").join("-");
  else s = s.replace("-r", "-");
  if (s === "in") s = "id";
  return s;
}

function unescape(s) {
  return s
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/%1\$s/g, "{0}");
}

const out = {};
for (const dir of readdirSync(res).filter((d) => /^values(-|$)/.test(d)).sort()) {
  const file = join(res, dir, "strings.xml");
  if (!existsSync(file)) continue;
  const xml = readFileSync(file, "utf8");
  const strings = {};
  for (const m of xml.matchAll(/<string name="([a-z_]+)"[^>]*>([\s\S]*?)<\/string>/g)) {
    if (KEYS.includes(m[1])) strings[m[1]] = unescape(m[2]);
  }
  if (Object.keys(strings).length) out[locale(dir)] = strings;
}

const extra = JSON.parse(readFileSync(join(root, "tools", "extra-strings.json"), "utf8"));
for (const [key, byLocale] of Object.entries(extra)) {
  if (key.startsWith("_")) continue;
  for (const [loc, text] of Object.entries(byLocale)) (out[loc] ||= {})[key] = text;
}

const missing = [];
for (const [loc, strings] of Object.entries(out)) {
  for (const k of [...KEYS, ...Object.keys(extra).filter((k) => !k.startsWith("_"))]) if (!(k in strings)) missing.push(`${loc}:${k}`);
}
if (missing.length) console.warn(`Missing (English is shown instead): ${missing.join(", ")}`);

const body =
  "// Made by tools/strings.mjs from the Android TV app's strings.xml files: don't edit by hand.\n" +
  "var STRINGS = " +
  JSON.stringify(out, null, 1) +
  ";\n";
writeFileSync(join(root, "app", "js", "strings.js"), body);
const langs = new Set(Object.keys(out).map((l) => l.split("-")[0]));
console.log(`app/js/strings.js: ${Object.keys(out).length} locales, ${langs.size} languages`);
