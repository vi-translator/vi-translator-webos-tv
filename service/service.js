/*
 * The app's background service (Node.js on the TV: 8.12 on webOS 5 and 6, newer later), for what a
 * webOS web app can't do itself:
 *
 * - pair: while this TV waits to be connected, answer VI Translator on the PC, which finds the TV
 *   (GET /vit-tv) and sends the code the user typed there, with its address and a key for this TV
 *   (POST /vit-tv/pair). Only requests carrying the X-VIT header are answered: a web page can't send
 *   it to the TV from a browser. A subscription: it sends the code, and then the connection.
 * - ask: how the PC is (its TV page answers this TV, its overlays are off, it removed this TV...).
 * - forget: tell the PC this TV disconnected.
 * - find: the PC got a new address from the router: look for it on the home network.
 *
 * The same protocol as the Android TV app (PairServer.kt, Pc.kt), unchanged.
 */
"use strict";

var Service = require("webos-service");
var http = require("http");
var crypto = require("crypto");
var os = require("os");

var service = new Service("app.vitranslator.tv.service");

var PORT = 8792;
/** wrong codes before the code changes */
var TRIES = 5;
var TOKEN = /^[0-9a-f]{32,128}$/;
var IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

// ---- pairing --------------------------------------------------------------------------------

var server = null;
var listening = false;
var code = "";
var wrong = 0;
var subscribers = {};
var tv = { id: "", name: "LG TV" };
var keepAlive = null;

function newCode() {
  // (a uniform 6-digit number: random values over the last whole million are drawn again)
  var n;
  do {
    n = crypto.randomBytes(4).readUInt32BE(0);
  } while (n >= 4294000000);
  code = ("00000" + (n % 1000000)).slice(-6);
  wrong = 0;
  tell({ code: code, listening: listening });
}

/** Send to every app subscribed to "pair". */
function tell(payload) {
  Object.keys(subscribers).forEach(function (k) {
    try {
      var p = { returnValue: true, subscribed: true };
      for (var key in payload) p[key] = payload[key];
      subscribers[k].respond(p);
    } catch (e) {
      // (that app went away)
    }
  });
}

/** Keep this service running while it waits: the library ends an idle service after 5 seconds. */
function hold() {
  if (keepAlive) return;
  keepAlive = "pending";
  service.activityManager.create("keepAlive", function (activity) {
    keepAlive = activity;
    if (!server) release(); // (stopped meanwhile)
  });
}

function release() {
  var a = keepAlive;
  keepAlive = null;
  if (a && a !== "pending") service.activityManager.complete(a, function () {});
}

function startServer() {
  if (server) return;
  newCode();
  hold();
  server = http.createServer(handle);
  server.on("error", function () {
    // (the port is taken: the PC won't find this TV; shown as waiting anyway)
    listening = false;
    tell({ code: code, listening: false });
  });
  server.listen(PORT, "0.0.0.0", function () {
    listening = true;
    tell({ code: code, listening: true });
  });
}

function stopServer() {
  var s = server;
  server = null;
  listening = false;
  code = "";
  if (s) {
    try {
      s.close();
    } catch (e) {
      // closing
    }
  }
  release();
}

function respond(res, status, obj) {
  var body = JSON.stringify(obj || {});
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    Connection: "close",
  });
  res.end(body);
}

function handle(req, res) {
  req.setTimeout(3000, function () {
    req.destroy();
  });
  if (!req.headers["x-vit"]) return respond(res, 403);
  if (req.method === "GET" && req.url === "/vit-tv") {
    return respond(res, 200, { app: "vi-translator-tv", id: tv.id, name: tv.name });
  }
  if (req.method === "POST" && req.url === "/vit-tv/pair") {
    var length = parseInt(req.headers["content-length"] || "-1", 10);
    if (!(length >= 1 && length <= 4096)) return respond(res, 404);
    var chunks = [];
    var size = 0;
    req.on("data", function (c) {
      size += c.length;
      if (size > 4096) {
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", function () {
      pair(res, Buffer.concat(chunks).toString("utf8"));
    });
    return;
  }
  respond(res, 404);
}

function pair(res, body) {
  var o;
  try {
    o = JSON.parse(body);
  } catch (e) {
    return respond(res, 400);
  }
  if (!o || typeof o !== "object") return respond(res, 400);
  if (!server) return respond(res, 404); // (stopped meanwhile)
  if (String(o.code) !== code) {
    if (++wrong >= TRIES) {
      newCode();
      return respond(res, 429);
    }
    return respond(res, 403);
  }
  var pc = address(o.pc);
  var token = typeof o.token === "string" ? o.token : "";
  if (!pc || !TOKEN.test(token)) return respond(res, 400);
  var pcName = (typeof o.pc_name === "string" ? o.pc_name.trim() : "").slice(0, 60) || "PC";
  respond(res, 200, { id: tv.id, name: tv.name });
  tell({ connected: { pc: pc, token: token, pcName: pcName } });
  // connected: no more listening (the app starts it again to be connected anew)
  setTimeout(stopServer, 200);
}

/** "ip:port", an IPv4 address on a home network and a port; null otherwise. */
function address(s) {
  if (typeof s !== "string") return null;
  var colon = s.lastIndexOf(":");
  if (colon < 0) return null;
  var host = s.slice(0, colon);
  var port = Number(s.slice(colon + 1));
  if (!(port >= 1 && port <= 65535) || Math.floor(port) !== port || !IPV4.test(host)) return null;
  var p = host.split(".").map(Number);
  var home = p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254);
  return home ? host + ":" + port : null;
}

service.register(
  "pair",
  function (message) {
    var p = message.payload || {};
    if (typeof p.id === "string" && p.id) tv.id = p.id.slice(0, 64);
    if (typeof p.name === "string" && p.name.trim()) tv.name = p.name.trim().slice(0, 60);
    if (!message.isSubscription) {
      message.respond({ returnValue: false, errorText: "subscribe: true is needed" });
      return;
    }
    subscribers[message.uniqueToken] = message;
    if (!server) startServer();
    message.respond({ returnValue: true, subscribed: true, code: code, listening: listening });
  },
  function (message) {
    delete subscribers[message.uniqueToken];
    if (!Object.keys(subscribers).length) stopServer();
  }
);

// ---- the PC ---------------------------------------------------------------------------------

/**
 * GET http://<pc><path>: calls back with (status, body), status 0 when there was no answer in time.
 * ms: the most it may take in all.
 */
function get(pc, path, ms, max, done) {
  var colon = pc.lastIndexOf(":");
  var finished = false;
  function end(status, body) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    done(status, body);
  }
  var req = http.get({ host: pc.slice(0, colon), port: Number(pc.slice(colon + 1)), path: path, agent: false, headers: { "Cache-Control": "no-store" } }, function (res) {
    var chunks = [];
    var size = 0;
    res.on("data", function (c) {
      size += c.length;
      if (size > max) {
        req.abort();
        end(0, "");
        return;
      }
      chunks.push(c);
    });
    res.on("end", function () {
      end(res.statusCode, Buffer.concat(chunks).toString("utf8"));
    });
    res.on("error", function () {
      end(0, "");
    });
  });
  req.on("error", function () {
    end(0, "");
  });
  var timer = setTimeout(function () {
    req.abort();
    end(0, "");
  }, ms);
}

/**
 * How the PC is: "ok" (it answers, and shows its overlays), "overlays_off" (it answers, but its
 * Overlays switch is off), "removed" (it doesn't know this TV any more) or "unreachable" (no answer:
 * the app closed, the PC off, sharing off, or a new address).
 */
function ask(pc, token, ms, done) {
  get(pc, "/tv.json?h=&t=" + encodeURIComponent(token), ms, 4 << 20, function (status, body) {
    if (status === 403) return done("removed");
    if (status !== 200 || body.indexOf('"areas"') < 0) return done("unreachable");
    done(body.indexOf('"overlays":false') >= 0 ? "overlays_off" : "ok");
  });
}

function checkPc(message) {
  var p = message.payload || {};
  var pc = address(p.pc);
  if (!pc || typeof p.token !== "string") {
    message.respond({ returnValue: false, errorText: "pc and token are needed" });
    return null;
  }
  return pc;
}

service.register("ask", function (message) {
  var pc = checkPc(message);
  if (!pc) return;
  ask(pc, message.payload.token, 6000, function (state) {
    message.respond({ returnValue: true, state: state });
  });
});

service.register("forget", function (message) {
  var pc = checkPc(message);
  if (!pc) return;
  get(pc, "/tv/forget?t=" + encodeURIComponent(message.payload.token), 3500, 65536, function (status) {
    message.respond({ returnValue: true, status: status });
  });
});

/** This TV's IPv4 address on the home network, or null. */
function ownAddress() {
  var all = os.networkInterfaces();
  var found = null;
  Object.keys(all).forEach(function (name) {
    (all[name] || []).forEach(function (a) {
      if (found || a.internal || (a.family !== "IPv4" && a.family !== 4)) return;
      if (address(a.address + ":1")) found = a.address;
    });
  });
  return found;
}

/**
 * The PC got a new address (from the router): look for it on this TV's /24 network, on the same
 * port, with this TV's key. Its new address, or null.
 */
service.register("find", function (message) {
  var pc = checkPc(message);
  if (!pc) return;
  var token = message.payload.token;
  var port = pc.slice(pc.lastIndexOf(":") + 1);
  var mine = ownAddress();
  if (!mine) {
    message.respond({ returnValue: true, pc: null });
    return;
  }
  var b = mine.split(".");
  var prefix = b[0] + "." + b[1] + "." + b[2] + ".";
  var me = Number(b[3]);
  var queue = [];
  for (var i = 1; i <= 254; i++) if (i !== me) queue.push(prefix + i + ":" + port);
  var found = null;
  var running = 0;
  var answered = false;
  function finish() {
    if (answered) return;
    answered = true;
    clearTimeout(limit);
    message.respond({ returnValue: true, pc: found });
  }
  function next() {
    if (found || answered) return;
    if (!queue.length) {
      if (!running) finish();
      return;
    }
    var a = queue.shift();
    running++;
    ask(a, token, 1900, function (state) {
      running--;
      if (!found && (state === "ok" || state === "overlays_off")) {
        found = a;
        finish();
        return;
      }
      next();
    });
  }
  var limit = setTimeout(finish, 30000);
  for (var n = 0; n < 48; n++) next();
});
