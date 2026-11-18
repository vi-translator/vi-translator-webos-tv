/*
 * VI Translator on an LG webOS TV: the translations from VI Translator on the PC, over what the TV
 * shows (the game on an HDMI input).
 *
 * The app's window is an overlay (appinfo.json "defaultWindowType"), transparent, above the input
 * or app on screen. It holds:
 * - the PC app's TV page (in #overlay), drawing the translations over the whole picture;
 * - the screen (#panel), minimal: not connected, the code to type in VI Translator on the PC;
 *   connected, the connection, "Show on" and Disconnect. Back hides it: the window then gives the
 *   remote back to the TV (an empty input region and key mask), and the translations stay.
 *
 * The background service (service/service.js) does what a web app can't: listens for the PC on the
 * home network while waiting to be connected, and asks the PC how it is.
 */
(function () {
  "use strict";

  var APP = "app.vitranslator.tv";
  var SERVICE = "luna://" + APP + ".service/";

  /** after the PC didn't answer (the PC off, the app closed) */
  var RETRY_MS = 5000;
  /** how often the PC is asked how it is */
  var CHECK_MS = 10000;
  /** how often the input on screen is looked at */
  var INPUT_MS = 400;
  /** how long it keeps waiting to be connected after its screen was hidden */
  var LINGER_MS = 10 * 60000;

  var sys = window.webOSSystem || window.PalmSystem || null;
  var $ = function (id) {
    return document.getElementById(id);
  };

  // ---- settings ---------------------------------------------------------------------------

  function load(k) {
    try {
      return localStorage.getItem(k) || "";
    } catch (e) {
      return "";
    }
  }

  function save(k, v) {
    try {
      if (v) localStorage.setItem(k, v);
      else localStorage.removeItem(k);
    } catch (e) {
      // (no storage: forgotten when the app closes)
    }
  }

  /** This app's own id: the PC knows this TV by it (connected again, it replaces the old key). */
  function appId() {
    var id = load("id");
    if (id) return id;
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    var h = "";
    for (var i = 0; i < 16; i++) h += (b[i] + 256).toString(16).slice(1);
    id = h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
    save("id", id);
    return id;
  }

  function connected() {
    return !!(load("pc") && load("token"));
  }

  // ---- strings ----------------------------------------------------------------------------

  var strings = STRINGS.en;
  var rtl = false;

  /** The strings for a locale ("pt-BR", "zh-Hant-TW", "es-US"), or the nearest one, or English. */
  function pick(locale) {
    var l = String(locale || "en").replace(/_/g, "-");
    var parts = l.split("-");
    var lang = parts[0].toLowerCase();
    if (lang === "in") lang = "id";
    var region = "";
    var script = "";
    for (var i = 1; i < parts.length; i++) {
      if (parts[i].length === 4) script = parts[i].charAt(0).toUpperCase() + parts[i].slice(1).toLowerCase();
      else if (parts[i].length === 2 || parts[i].length === 3) region = parts[i].toUpperCase();
    }
    var tries = [];
    if (region) tries.push(lang + "-" + region);
    if (lang === "zh") tries.push(script === "Hant" || /^(TW|HK|MO)$/.test(region) ? "zh-Hant" : "zh-Hans");
    if (lang === "es" && region && region !== "ES") tries.push("es-419");
    if (lang === "fil") tries.push("tl");
    tries.push(lang);
    for (var j = 0; j < tries.length; j++) {
      if (STRINGS[tries[j]]) return { strings: STRINGS[tries[j]], rtl: /^(ar|fa|ur|he|iw)$/.test(lang) };
    }
    return { strings: STRINGS.en, rtl: false };
  }

  function t(key, arg) {
    var s = strings[key] || STRINGS.en[key] || "";
    return arg === undefined ? s : s.replace("{0}", arg);
  }

  function setLocale(locale) {
    var p = pick(locale);
    strings = p.strings;
    rtl = p.rtl;
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    render();
  }

  // ---- the TV -----------------------------------------------------------------------------

  var tvName = "LG TV";
  var nameRead = false;

  /** The TV's name as set in its settings ("Living room TV"), or its model. */
  function readTvName(done) {
    var finished = false;
    function end(name) {
      if (finished) return;
      finished = true;
      if (name) tvName = name;
      nameRead = true;
      done();
    }
    luna("luna://com.webos.settingsservice/getSystemSettings", { category: "network", keys: ["deviceName"] }, function (r) {
      var n = r && r.settings && typeof r.settings.deviceName === "string" ? r.settings.deviceName.trim() : "";
      if (n) return end(n);
      luna("luna://com.webos.service.tv.systemproperty/getSystemInfo", { keys: ["modelName"] }, function (r2) {
        end(r2 && typeof r2.modelName === "string" && r2.modelName ? "LG " + r2.modelName : "");
      });
    });
    setTimeout(function () {
      end("");
    }, 2500);
  }

  function readLocale() {
    setLocale(navigator.language);
    luna("luna://com.webos.settingsservice/getSystemSettings", { keys: ["localeInfo"] }, function (r) {
      var ui = r && r.settings && r.settings.localeInfo && r.settings.localeInfo.locales && r.settings.localeInfo.locales.UI;
      if (ui) setLocale(ui);
    });
  }

  // ---- the window and the remote ------------------------------------------------------------

  /** A webOSSystem call: newer webOS takes the value itself, webOS 5 a JSON string. */
  function system(name, value) {
    if (!sys || typeof sys[name] !== "function") return;
    try {
      sys[name](value);
    } catch (e) {
      try {
        sys[name](JSON.stringify(value));
      } catch (e2) {
        // (not on this TV)
      }
    }
  }

  /**
   * The window's "needFocus" property says whether the remote's keys come to it: without it, an
   * overlay window keeps them even when its input region is empty (tried on the webOS 5 emulator,
   * where setInputRegion and setKeyMask alone left the keys with this app).
   */
  function needFocus(on) {
    if (!sys || typeof sys.setWindowProperty !== "function") return;
    try {
      sys.setWindowProperty("needFocus", on ? "true" : "false");
    } catch (e) {
      // (not on this TV)
    }
  }

  /** The remote comes to this window (its screen shows). */
  function takeRemote() {
    needFocus(true);
    system("setInputRegion", [{ x: 0, y: 0, width: 1920, height: 1080 }]);
    if (sys && typeof sys.activate === "function") {
      try {
        sys.activate();
      } catch (e) {
        // (already in front)
      }
    }
  }

  /** The remote stays with the TV and the input under this window (only the translations show). */
  function giveRemote() {
    needFocus(false);
    // (and the Magic Remote's pointer)
    system("setInputRegion", [{ x: 0, y: 0, width: 0, height: 0 }]);
  }

  // ---- the screen -------------------------------------------------------------------------

  var panelShown = false;
  var lingering = null;
  var focus = 0;

  function showPanel() {
    clearTimeout(lingering);
    lingering = null;
    panelShown = true;
    $("panel").classList.remove("hidden");
    takeRemote();
    if (!connected()) startPairing();
    render();
  }

  /** Back: the screen hides, the translations stay; still waiting to be connected, for a while. */
  function hidePanel() {
    panelShown = false;
    $("panel").classList.add("hidden");
    giveRemote();
    if (!connected()) linger();
  }

  function linger() {
    clearTimeout(lingering);
    lingering = setTimeout(function () {
      if (!connected() && !panelShown) window.close();
    }, LINGER_MS);
  }

  /** "482913" as "482 913" (easier to read from the sofa). */
  function spaced(c) {
    return c && c.length === 6 ? c.slice(0, 3) + " " + c.slice(3) : "";
  }

  function buttons() {
    var b = [];
    if (connected()) {
      if (inputs.length) b.push($("showOn"));
      b.push($("disconnect"));
    }
    return b;
  }

  function render() {
    var on = connected();
    $("waiting").classList.toggle("hidden", on);
    $("connected").classList.toggle("hidden", !on);
    $("hint").textContent = t("hide_hint");
    if (!on) {
      $("enterCode").textContent = t("enter_code");
      $("whereOnPc").textContent = t("where_on_pc");
      $("thisTv").textContent = t("this_tv", tvName);
      $("code").textContent = spaced(code);
      return;
    }
    var pc = load("pc_name") || "PC";
    var color = "var(--orange)";
    var text = t("looking_for", pc);
    if (state === "ok") {
      color = "var(--neon)";
      text = t("connected_to", pc);
    } else if (state === "overlays_off") {
      color = "var(--warn)";
      text = t("overlays_off", pc);
    }
    $("dot").style.background = color;
    $("dot").style.color = color;
    $("statusText").textContent = text;
    $("showOn").classList.toggle("hidden", !inputs.length);
    $("showOn").textContent = t("show_on", showOnLabel());
    $("disconnect").textContent = t("disconnect");
    var b = buttons();
    if (focus >= b.length) focus = 0;
    for (var i = 0; i < b.length; i++) b[i].classList.toggle("focus", i === focus);
  }

  function press() {
    var b = buttons()[focus];
    if (b === $("showOn")) nextShowOn();
    else if (b === $("disconnect")) disconnect();
  }

  document.addEventListener(
    "keydown",
    function (e) {
      if (!panelShown) return;
      var k = e.keyCode;
      var n = buttons().length;
      if (k === 461 || k === 27 || k === 8) {
        // Back (the remote), or Esc / Backspace on a keyboard
        hidePanel();
      } else if ((k === 37 || k === 39) && n) {
        // (the buttons run right to left in Arabic, Persian and Urdu)
        var forward = (k === 39) !== rtl;
        focus = (focus + (forward ? 1 : n - 1)) % n;
        render();
      } else if (k === 13 && n) {
        press();
      } else {
        return;
      }
      e.preventDefault();
    },
    true
  );

  // (a pointer: the Magic Remote)
  $("showOn").addEventListener("click", function () {
    focus = 0;
    nextShowOn();
  });
  $("disconnect").addEventListener("click", disconnect);
  $("showOn").addEventListener("mouseover", function () {
    focus = 0;
    render();
  });
  $("disconnect").addEventListener("mouseover", function () {
    focus = buttons().length - 1;
    render();
  });

  // ---- waiting to be connected ------------------------------------------------------------

  var pairing = null;
  var code = "";
  var pairRetry = null;

  function startPairing() {
    // (only once the TV's name is known: the PC shows it)
    if (pairing || connected() || !nameRead) return;
    clearTimeout(pairRetry);
    pairing = luna(SERVICE + "pair", { subscribe: true, id: appId(), name: tvName }, function (r) {
      if (!r || r.returnValue === false) {
        // (the service didn't start: try again)
        stopPairing();
        pairRetry = setTimeout(startPairing, 3000);
        return;
      }
      if (typeof r.code === "string") code = r.code;
      if (r.connected && r.connected.pc && r.connected.token) {
        stopPairing();
        save("pc", r.connected.pc);
        save("token", r.connected.token);
        save("pc_name", r.connected.pcName || "PC");
        clearTimeout(lingering);
        lingering = null;
        state = "unreachable";
        startOverlay();
      }
      render();
    });
  }

  function stopPairing() {
    if (pairing) pairing.cancel();
    pairing = null;
    code = "";
  }

  // ---- connected: the overlay -------------------------------------------------------------

  var state = "unreachable";
  var unreachable = 0;
  var finding = false;
  var checking = null;
  var shownUrl = "";

  /** The TV page, with this TV's key. */
  function pageUrl(pc, token) {
    return "http://" + pc + "/tv?t=" + encodeURIComponent(token);
  }

  function startOverlay() {
    clearTimeout(checking);
    unreachable = 0;
    check();
  }

  function stopOverlay() {
    clearTimeout(checking);
    checking = null;
    state = "unreachable";
    show("");
  }

  /** The page in the overlay ("": nothing). */
  function show(url) {
    if (url === shownUrl) return;
    shownUrl = url;
    $("overlay").src = url || "about:blank";
  }

  /**
   * How the PC is: removed this TV (disconnect), gone a while (look for it at a new address), or
   * there (the page shows: only once the PC answers this TV as connected, so an error page never
   * shows over the game).
   */
  function check() {
    clearTimeout(checking);
    checking = null;
    if (!connected()) return;
    var pc = load("pc");
    var token = load("token");
    luna(SERVICE + "ask", { pc: pc, token: token }, function (r) {
      if (pc !== load("pc") || token !== load("token")) return; // (changed meanwhile)
      var s = (r && r.state) || "unreachable";
      state = s;
      if (s === "removed") {
        forgetHere();
        return;
      }
      if (s === "ok" || s === "overlays_off") {
        unreachable = 0;
        show(pageUrl(pc, token));
      } else {
        unreachable++;
        if (unreachable >= 3 && !finding) findPc(pc, token);
      }
      render();
      checking = setTimeout(check, s === "unreachable" && !shownUrl ? RETRY_MS : CHECK_MS);
    });
  }

  function findPc(pc, token) {
    finding = true;
    luna(SERVICE + "find", { pc: pc, token: token }, function (r) {
      finding = false;
      var found = r && r.pc;
      if (found && found !== pc && pc === load("pc")) {
        save("pc", found);
        unreachable = 0;
        check();
      }
    });
  }

  /** Disconnect: the PC forgets this TV, and this TV shows a new code. */
  function disconnect() {
    var pc = load("pc");
    var token = load("token");
    if (pc && token) luna(SERVICE + "forget", { pc: pc, token: token }, function () {});
    forgetHere();
  }

  /** Not connected any more (Disconnect, or removed in the PC app): back to showing a code. */
  function forgetHere() {
    save("pc", "");
    save("token", "");
    save("pc_name", "");
    stopOverlay();
    focus = 0;
    startPairing();
    if (!panelShown) linger();
    render();
  }

  // ---- Show on: the overlay only over one input ---------------------------------------------

  /** HDMI inputs ({appId, label}), empty when this TV doesn't tell which input is on screen. */
  var inputs = [];
  /** the app on screen under this window ("com.webos.app.hdmi2"), null when unknown */
  var foreground = null;

  function watchInputs() {
    // the app on screen: an HDMI input is an app of its own on webOS ("com.webos.app.hdmi1")
    luna("luna://com.webos.applicationManager/getForegroundAppInfo", { subscribe: true }, function (r) {
      if (!r || r.returnValue === false || typeof r.appId !== "string") return;
      if (r.appId === APP) return; // (this app's own screen)
      var first = foreground === null;
      foreground = r.appId;
      if (first) listInputs();
      applyShowOn();
    });
  }

  function listInputs() {
    luna("luna://com.webos.service.eim/getAllInputStatus", {}, function (r) {
      var list = [];
      var devices = (r && (r.devices || r.inputSourceList)) || [];
      for (var i = 0; i < devices.length; i++) {
        var d = devices[i];
        if (d && typeof d.appId === "string" && /hdmi/i.test(d.appId)) {
          var port = d.port ? "HDMI " + d.port : d.label || "HDMI";
          var name = d.label && d.label !== port ? port + " (" + d.label + ")" : port;
          list.push({ appId: d.appId, label: name });
        }
      }
      if (!list.length) {
        // (the list isn't readable: the usual four)
        for (var n = 1; n <= 4; n++) list.push({ appId: "com.webos.app.hdmi" + n, label: "HDMI " + n });
      }
      inputs = list;
      render();
    });
  }

  function showOnLabel() {
    var on = load("show_on");
    for (var i = 0; i < inputs.length; i++) if (inputs[i].appId === on) return inputs[i].label;
    return t("all_inputs");
  }

  /** Show on: every input, then each HDMI input in turn. */
  function nextShowOn() {
    var on = load("show_on");
    var i = -1;
    for (var j = 0; j < inputs.length; j++) if (inputs[j].appId === on) i = j;
    var next = inputs[i + 1];
    save("show_on", next ? next.appId : "");
    applyShowOn();
    render();
  }

  /** The translations only while the chosen input is on screen. */
  function applyShowOn() {
    var on = load("show_on");
    var visible = !on || !inputs.length || foreground === null || foreground === on;
    var o = $("overlay");
    var v = visible ? "visible" : "hidden";
    if (o.style.visibility !== v) o.style.visibility = v;
  }

  // ---- start ------------------------------------------------------------------------------

  // the app opened again (from the launcher) while it runs: its screen shows again
  document.addEventListener("webOSRelaunch", function () {
    showPanel();
  });

  readLocale();
  readTvName(function () {
    startPairing();
    render();
  });
  showPanel();
  if (connected()) startOverlay();
  watchInputs();
  setInterval(applyShowOn, INPUT_MS);
})();
