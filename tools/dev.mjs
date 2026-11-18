// A test harness on the PC, for trying the app without a TV:
// - runs service/service.js with a stand-in for the TV's "webos-service" library (so the code
//   listener really listens on port 8792, as on the TV);
// - serves app/ on http://127.0.0.1:8793/?dev=http://127.0.0.1:8793 , whose Luna calls (luna.js)
//   come here as server-sent events;
// - with --mock-pc, a stand-in for VI Translator on the PC on port 8799 (its TV page and tv.json),
//   which can connect the "TV" too: GET http://127.0.0.1:8799/connect?code=123456 .
//
//   node tools/dev.mjs [--mock-pc] [--inputs] [--locale=ar-SA]   (--inputs: pretend the TV says which input is on screen)
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import Module from "node:module";
import os from "node:os";
import crypto from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const DEV_PORT = 8793;
const PC_PORT = 8799;

// ---- the service, with a stand-in for webos-service -------------------------------------------

const handlers = {};
class FakeService {
  constructor(id) {
    this.id = id;
    this.activityManager = {
      create(name, cb) {
        console.log(`[service] activity ${name} created`);
        setTimeout(() => cb({ activityId: 1, name }), 0);
      },
      complete(a, cb) {
        console.log(`[service] activity ${a && a.name} completed`);
        if (cb) setTimeout(cb, 0);
      },
    };
  }
  register(name, request, cancel) {
    handlers[name] = { request, cancel };
  }
}
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "webos-service") return FakeService;
  return load.call(this, request, ...rest);
};
createRequire(import.meta.url)(join(root, "service", "service.js"));

let tokens = 0;
function serviceCall(name, params, res) {
  const h = handlers[name];
  if (!h) return send(res, { returnValue: false, errorText: `Unknown method "${name}"` }, true);
  const message = {
    payload: params,
    isSubscription: !!params.subscribe,
    uniqueToken: `t${++tokens}`,
    respond(obj) {
      send(res, obj, !params.subscribe);
    },
  };
  if (params.subscribe) res.on("close", () => h.cancel && h.cancel(message));
  h.request(message);
}

/** other TV services: what this harness pretends the TV answers */
function tvCall(uri, params, res) {
  if (uri === "luna://com.webos.settingsservice/getSystemSettings" && params.category === "network") {
    return send(res, { returnValue: true, settings: { deviceName: "Test TV" } }, true);
  }
  const locale = (args.find((a) => a.startsWith("--locale=")) || "").slice("--locale=".length);
  if (uri === "luna://com.webos.settingsservice/getSystemSettings" && locale) {
    return send(res, { returnValue: true, settings: { localeInfo: { locales: { UI: locale } } } }, true);
  }
  if (uri === "luna://com.webos.applicationManager/getForegroundAppInfo" && args.includes("--inputs")) {
    send(res, { returnValue: true, appId: "com.webos.app.hdmi1" }, false);
    let n = 1;
    const t = setInterval(() => send(res, { returnValue: true, appId: `com.webos.app.hdmi${(n++ % 2) + 1}` }, false), 8000);
    res.on("close", () => clearInterval(t));
    return;
  }
  if (uri === "luna://com.webos.service.eim/getAllInputStatus" && args.includes("--inputs")) {
    return send(
      res,
      { returnValue: true, devices: [1, 2, 3].map((p) => ({ appId: `com.webos.app.hdmi${p}`, port: p, label: p === 2 ? "PS5" : `HDMI ${p}` })) },
      true,
    );
  }
  send(res, { returnValue: false, errorText: "not in this harness" }, true);
}

function send(res, obj, last) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
  if (last) setTimeout(() => res.end(), 50);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ttf": "font/ttf", ".json": "application/json" };

http
  .createServer((req, res) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname === "/luna") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
      const uri = u.searchParams.get("uri");
      const params = JSON.parse(u.searchParams.get("params") || "{}");
      console.log(`[luna] ${uri} ${JSON.stringify(params)}`);
      const m = uri.match(/^luna:\/\/app\.vitranslator\.tv\.service\/(\w+)$/);
      if (m) serviceCall(m[1], params, res);
      else tvCall(uri, params, res);
      return;
    }
    const file = join(root, "app", u.pathname === "/" ? "index.html" : decodeURIComponent(u.pathname));
    if (!file.startsWith(join(root, "app")) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  })
  .listen(DEV_PORT, "127.0.0.1", () => console.log(`App: http://127.0.0.1:${DEV_PORT}/?dev=http://127.0.0.1:${DEV_PORT}`));

// ---- a stand-in for VI Translator on the PC ---------------------------------------------------

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === "IPv4" && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) return a.address;
  }
  return null;
}

if (args.includes("--mock-pc")) {
  const known = new Set();
  let overlays = true;
  http
    .createServer(async (req, res) => {
      const u = new URL(req.url, `http://${req.headers.host}`);
      const t = u.searchParams.get("t") || "";
      const json = (status, obj) => {
        res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(obj));
      };
      if (u.pathname === "/connect") {
        // what VI Translator does when the user types the code: find the TV, then pair
        const ip = lanAddress();
        const tv = `${ip}:8792`;
        try {
          const hello = await fetch(`http://${tv}/vit-tv`, { headers: { "X-VIT": "1" } }).then((r) => r.json());
          const token = crypto.randomBytes(32).toString("hex");
          const r = await fetch(`http://${tv}/vit-tv/pair`, {
            method: "POST",
            headers: { "X-VIT": "1", "Content-Type": "application/json" },
            body: JSON.stringify({ code: u.searchParams.get("code"), pc: `${ip}:${PC_PORT}`, pc_name: "Test PC", token }),
          });
          if (r.status === 200) known.add(token);
          return json(200, { hello, pair: r.status, answer: await r.text() });
        } catch (e) {
          return json(502, { error: String(e.cause || e) });
        }
      }
      if (u.pathname === "/remove") {
        known.clear();
        return json(200, {});
      }
      if (u.pathname === "/overlays") {
        overlays = u.searchParams.get("on") !== "0";
        return json(200, { overlays });
      }
      if (!known.has(t)) return json(403, {});
      if (u.pathname === "/tv.json") return json(200, { version: "1", overlays, areas: [], shown: {} });
      if (u.pathname === "/tv/forget") {
        known.delete(t);
        return json(200, {});
      }
      if (u.pathname === "/tv") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(
          '<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">' +
            '<div style="position:fixed;left:0;right:0;bottom:90px;text-align:center;font:600 46px sans-serif;color:#fff;text-shadow:0 0 6px #000,0 0 3px #000">' +
            "Test subtitle from the mock PC</div></body></html>",
        );
      }
      json(404, {});
    })
    .listen(PC_PORT, "0.0.0.0", () => console.log(`Mock PC: http://${lanAddress()}:${PC_PORT}  (connect: /connect?code=XXXXXX)`));
}
