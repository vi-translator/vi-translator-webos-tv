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

  /** the language button's globe, as on Android TV */
  var GLOBE = "🌐";

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

  /** the TV's own language ("en-US"), used when none was picked in the app */
  var tvLocale = navigator.language || "en";

  /** The app's language: the one picked in the app, or the TV's own. */
  function readLocale() {
    setLocale(load("language") || tvLocale);
    luna("luna://com.webos.settingsservice/getSystemSettings", { keys: ["localeInfo"] }, function (r) {
      var ui = r && r.settings && r.settings.localeInfo && r.settings.localeInfo.locales && r.settings.localeInfo.locales.UI;
      if (!ui) return;
      tvLocale = ui;
      if (!load("language")) setLocale(ui);
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

  // ---- the app's language -------------------------------------------------------------------

  /** The desktop app's 33 interface languages, in its order, by their own names (as on Android TV). */
  var LANGS = [
    ["en", "English"],
    ["ar", "العربية"],
    ["hi", "हिन्दी"],
    ["bn", "বাংলা"],
    ["ur", "اردو"],
    ["id", "Bahasa Indonesia"],
    ["tr", "Türkçe"],
    ["vi", "Tiếng Việt"],
    ["fa", "فارسی"],
    ["th", "ไทย"],
    ["ta", "தமிழ்"],
    ["te", "తెలుగు"],
    ["mr", "मराठी"],
    ["uk", "Українська"],
    ["nl", "Nederlands"],
    ["fil", "Filipino"],
    ["ms", "Bahasa Melayu"],
    ["sw", "Kiswahili"],
    ["ro", "Română"],
    ["el", "Ελληνικά"],
    ["cs", "Čeština"],
    ["fr", "Français"],
    ["it", "Italiano"],
    ["de", "Deutsch"],
    ["ru", "Русский"],
    ["ja", "日本語"],
    ["pl", "Polski"],
    ["ko", "한국어"],
    ["zh-Hans-CN", "简体中文"],
    ["zh-Hant-TW", "繁體中文"],
    ["es-MX", "Español (México)"],
    ["es-ES", "Español (España)"],
    ["pt-BR", "Português (Brasil)"],
  ];

  /** The chosen language's name, or "" when the TV's own is used. */
  function chosenName() {
    var tag = load("language");
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i][0] === tag) return LANGS[i][1];
    return "";
  }

  /** The language list: the TV's own first, then each language by its own name. */
  function pickLanguage() {
    var tag = load("language");
    var names = [t("language_tv")];
    var checked = 0;
    for (var i = 0; i < LANGS.length; i++) {
      names.push(LANGS[i][1]);
      if (LANGS[i][0] === tag) checked = i + 1;
    }
    openPicker(t("language"), names, checked, function (which) {
      save("language", which === 0 ? "" : LANGS[which - 1][0]);
      setLocale(load("language") || tvLocale);
    });
  }

  // ---- the screen's buttons and the remote ---------------------------------------------------

  /** the button the remote is on: "language", "playOn", "showOn" or "disconnect" */
  var focused = "";

  /** The row of buttons under the connection (none while waiting). */
  function row() {
    var b = [];
    if (connected()) {
      b.push("playOn");
      if (inputs.length) b.push("showOn");
      b.push("disconnect");
    }
    return b;
  }

  function render() {
    var on = connected();
    $("waiting").classList.toggle("hidden", on);
    $("connected").classList.toggle("hidden", !on);
    $("hint").textContent = t("hide_hint");
    $("language").textContent = GLOBE + "  " + (chosenName() || t("language_tv"));
    var r = row();
    // (where Android TV puts the focus: the first button under the connection, or the language)
    if (focused !== "language" && r.indexOf(focused) < 0) focused = r.length ? r[0] : "language";
    ["language", "playOn", "showOn", "disconnect"].forEach(function (id) {
      $(id).classList.toggle("focus", id === focused);
    });
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
    $("statusText").textContent = text;
    $("playOn").textContent = t("play_on");
    $("showOn").classList.toggle("hidden", !inputs.length);
    $("showOn").textContent = t("show_on", showOnLabel());
    $("disconnect").textContent = t("disconnect");
  }

  function press(id) {
    if (id === "language") pickLanguage();
    else if (id === "playOn") pickPlayOn();
    else if (id === "showOn") pickShowOn();
    else if (id === "disconnect") disconnect();
  }

  /** Arrows: up to the language in the corner, down to the buttons, left and right along them. */
  function move(k) {
    var r = row();
    if (k === 38) {
      focused = "language";
    } else if (k === 40) {
      if (focused === "language" && r.length) focused = r[0];
    } else if (focused !== "language" && r.length) {
      // (the buttons run right to left in Arabic, Persian and Urdu)
      var forward = (k === 39) !== rtl;
      var i = r.indexOf(focused);
      i = Math.min(r.length - 1, Math.max(0, i + (forward ? 1 : -1)));
      focused = r[i];
    }
    render();
  }

  document.addEventListener(
    "keydown",
    function (e) {
      if (!panelShown) return;
      var k = e.keyCode;
      var back = k === 461 || k === 27 || k === 8; // Back (the remote), or Esc / Backspace on a keyboard
      if (picker) {
        if (back) closePicker();
        else if (k === 38 || k === 40) movePicker(k === 40 ? 1 : -1);
        else if (k === 13) choose(picker.at);
        else return;
      } else if (back) {
        hidePanel();
      } else if (k >= 37 && k <= 40) {
        move(k);
      } else if (k === 13) {
        press(focused);
      } else {
        return;
      }
      e.preventDefault();
    },
    true
  );

  // (a pointer: the Magic Remote)
  ["language", "playOn", "showOn", "disconnect"].forEach(function (id) {
    $(id).addEventListener("click", function () {
      focused = id;
      render();
      press(id);
    });
    $(id).addEventListener("mouseover", function () {
      if (picker) return;
      focused = id;
      render();
    });
  });

  // ---- a list to pick from --------------------------------------------------------------------

  /** the open list: {names, at (the item the remote is on), done(index)}, or null */
  var picker = null;

  function openPicker(title, names, checked, done) {
    picker = { names: names, at: checked, done: done };
    $("pickerTitle").textContent = title;
    var list = $("pickerList");
    list.innerHTML = "";
    names.forEach(function (name, i) {
      var d = document.createElement("div");
      d.className = "item" + (i === checked ? " checked" : "");
      d.textContent = name;
      d.addEventListener("mouseover", function () {
        picker.at = i;
        paintPicker();
      });
      d.addEventListener("click", function () {
        choose(i);
      });
      list.appendChild(d);
    });
    $("picker").classList.remove("hidden");
    paintPicker();
  }

  function paintPicker() {
    var items = $("pickerList").children;
    for (var i = 0; i < items.length; i++) items[i].classList.toggle("focus", i === picker.at);
    var on = items[picker.at];
    if (on) on.scrollIntoView({ block: "nearest" });
  }

  function movePicker(by) {
    picker.at = Math.min(picker.names.length - 1, Math.max(0, picker.at + by));
    paintPicker();
  }

  function choose(i) {
    var done = picker.done;
    closePicker();
    done(i);
  }

  function closePicker() {
    picker = null;
    $("picker").classList.add("hidden");
    render();
  }

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
    // (the service opens this app again over the game when the TV's input changes)
    luna(SERVICE + "watch", { on: true }, function () {});
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
    lastAlive = 0;
    everAlive = false;
    $("overlay").src = url || "about:blank";
  }

  // ---- the page staying alive ---------------------------------------------------------------
  // The TV page tells it is alive after each answer from the PC (a message from its frame; PC apps from
  // 1.2.2 on). A page that went quiet while the PC answers this TV (see check) is loaded again: a request
  // the network dropped without a word stops it, and so can the TV pausing the app for a while. Never
  // while the PC is away: the page then keeps trying by itself, and a page loaded then would be an error
  // page that never tries again. (Only once the page has told it once: an older PC app's page never
  // does, and is left alone.)

  /** how long the page may stay quiet, the PC answering, before it's loaded again */
  var QUIET_MS = 20000;
  var lastAlive = 0;
  var everAlive = false;

  window.addEventListener("message", function (e) {
    if (!shownUrl || !e.data || e.data.vit !== "alive") return;
    // (from the PC's page only)
    if (shownUrl.indexOf(e.origin + "/") !== 0) return;
    lastAlive = Date.now();
    everAlive = true;
  });

  function reloadOverlay() {
    var url = shownUrl;
    if (!url) return;
    lastAlive = Date.now(); // (its time to load and answer)
    $("overlay").src = "about:blank";
    setTimeout(function () {
      if (shownUrl === url) $("overlay").src = url;
    }, 100);
  }

  /** The PC answered this TV: the page loaded again if it went quiet. */
  function reviveIfQuiet() {
    if (shownUrl && everAlive && Date.now() - lastAlive > QUIET_MS) reloadOverlay();
  }

  // shown again after the TV had it paused: the PC asked at once (the page is loaded again if it went quiet)
  document.addEventListener("visibilitychange", function () {
    if (document.hidden || !connected()) return;
    check();
  });

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
        reviveIfQuiet();
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
    luna(SERVICE + "watch", { on: false }, function () {});
    save("pc", "");
    save("token", "");
    save("pc_name", "");
    stopOverlay();
    focused = "";
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

  /** Show on: a list like the language one, every input first, then each HDMI input by its name. */
  function pickShowOn() {
    var on = load("show_on");
    var names = [t("all_inputs")];
    var checked = 0;
    for (var i = 0; i < inputs.length; i++) {
      names.push(inputs[i].label);
      if (inputs[i].appId === on) checked = i + 1;
    }
    // (the title is the button's "Show on: …" without its value: every language has "label: value")
    var title = t("show_on", "").replace(/[\s:：]+$/, "");
    openPicker(title, names, checked, function (which) {
      save("show_on", which === 0 ? "" : inputs[which - 1].appId);
      applyShowOn();
      render();
    });
  }

  // ---- Play on: switch to the game's input, with the translations over it --------------------------
  // Switching the input with the remote's Source button closes this app (webOS keeps one app in front).
  // Here the service switches it, then opens this app again over the input, its screen hidden.

  /** HDMI inputs to play on: the TV's own list, or the usual four. */
  function playInputs() {
    if (inputs.length) return inputs;
    var list = [];
    for (var n = 1; n <= 4; n++) list.push({ appId: "com.webos.app.hdmi" + n, label: "HDMI " + n });
    return list;
  }

  function pickPlayOn() {
    var list = playInputs();
    var last = load("play_input");
    var names = [];
    var checked = 0;
    for (var i = 0; i < list.length; i++) {
      names.push(list[i].label);
      if (list[i].appId === last) checked = i;
    }
    openPicker(t("play_on").replace(/[\s…:.]+$/, ""), names, checked, function (which) {
      var input = list[which].appId;
      save("play_input", input);
      luna(SERVICE + "play", { input: input }, function () {});
    });
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

  /** The parameters this app was (re)opened with: {overlay: true} from the service, over the game. */
  function launchParams() {
    try {
      var p = sys && sys.launchParams;
      return (typeof p === "string" ? JSON.parse(p || "{}") : p) || {};
    } catch (e) {
      return {};
    }
  }

  // the app opened again while it runs: from the launcher, its screen shows again; from the service
  // (over the game), it stays hidden
  document.addEventListener("webOSRelaunch", function () {
    if (launchParams().overlay && connected()) {
      hidePanel();
      check();
    } else {
      showPanel();
    }
  });

  readLocale();
  readTvName(function () {
    startPairing();
    render();
  });
  if (launchParams().overlay && connected()) hidePanel();
  else showPanel();
  if (connected()) startOverlay();
  watchInputs();
  listInputs();
  setInterval(applyShowOn, INPUT_MS);
})();
