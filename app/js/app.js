/*
 * VI Translator on an LG webOS TV: the game from the console's HDMI input, shown inside this app,
 * with the translations from VI Translator on the PC over it.
 *
 * The app holds, bottom to top:
 * - the game (#stage): the HDMI input as a video ("ext://hdmi:N"), played inside the app, so the app
 *   stays the one in front the whole game (an app over the TV's own HDMI input was paused or closed
 *   by webOS after a few minutes);
 * - the PC app's TV page (in #overlay), drawing the translations over the whole picture;
 * - the screen (#panel), minimal: not connected, the code to type in VI Translator on the PC;
 *   connected, the connection, "Play on…" and Disconnect. Back hides it over the game, and shows it
 *   again.
 * While the game plays, awake.js keeps the TV from its screen saver.
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
  /** how long it keeps waiting to be connected after it went to the background */
  var LINGER_MS = 10 * 60000;
  /** no picture from the input within this long: said on the screen */
  var NO_PICTURE_MS = 8000;
  /**
   * After the picture failed: tried again after these waits (the last one repeating), unless it came
   * back by itself meanwhile. webOS reports passing hiccups as failures too: restarting at once broke
   * a picture that was coming back, and that restart's own hiccup the next one (cut every few seconds).
   */
  var VIDEO_RETRY_MS = [3000, 5000, 10000, 20000, 30000];
  /** hidden this long (another app or the TV's menu in front): the HDMI picture is let go */
  var RELEASE_HIDDEN_MS = 3000;

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

  // ---- the screen -------------------------------------------------------------------------

  var panelShown = false;
  var lingering = null;

  function showPanel() {
    clearTimeout(lingering);
    lingering = null;
    panelShown = true;
    $("panel").classList.remove("hidden");
    if (!connected()) startPairing();
    render();
  }

  /** Over the game: the screen hides, the game and its translations stay. */
  function hidePanel() {
    panelShown = false;
    $("panel").classList.add("hidden");
  }

  /**
   * Back with no game on: the app goes to the background (the TV's home), still waiting to be
   * connected for a while, with the same code (the PC may be on another input of this TV).
   */
  function toBackground() {
    var back = (window.webOS && window.webOS.platformBack) || (sys && sys.platformBack);
    if (connected() || !back) {
      window.close();
      return;
    }
    linger();
    try {
      back.call(window.webOS && window.webOS.platformBack ? window.webOS : sys);
    } catch (e) {
      window.close();
    }
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

  /** the button the remote is on: "language", "playOn" or "disconnect" */
  var focused = "";

  /** The row of buttons under the connection (none while waiting). */
  function row() {
    var b = [];
    if (connected()) {
      b.push("playOn");
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
    ["language", "playOn", "disconnect"].forEach(function (id) {
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
    $("disconnect").textContent = t("disconnect");
    $("pictureStatus").textContent = pictureNote;
    $("details").textContent = details();
  }

  function press(id) {
    if (id === "language") pickLanguage();
    else if (id === "playOn") pickPlayOn();
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
      var k = e.keyCode;
      var back = k === 461 || k === 27 || k === 8; // Back (the remote), or Esc / Backspace on a keyboard
      if (!panelShown) {
        // over the game: Back or OK brings the screen back; the other keys do nothing (the game is
        // played on the console's controller)
        if (back || k === 13) showPanel();
        e.preventDefault();
        return;
      }
      if (picker) {
        if (back) closePicker();
        else if (k === 38 || k === 40) movePicker(k === 40 ? 1 : -1);
        else if (k === 13) choose(picker.at);
        else return;
      } else if (back) {
        if (video && playing) hidePanel();
        else toBackground();
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
  ["language", "playOn", "disconnect"].forEach(function (id) {
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
    save("pc", "");
    save("token", "");
    save("pc_name", "");
    stopOverlay();
    focused = "";
    startPairing();
    if (!panelShown) linger();
    render();
  }

  // ---- the game: the HDMI input inside the app ---------------------------------------------------
  // The input plays as a video (<source type="service/webos-external" src="ext://hdmi:N">). webOS sends
  // "stalled" a few seconds after "playing" and then now and then while the picture runs fine: only a
  // real failure (error, abort, emptied, ended) starts it again.

  var FAILED = { error: 1, abort: 1, emptied: 1, ended: 1 };
  /** HDMI inputs ({n, label}): the TV's own list, or the usual four */
  var inputs = [];
  var video = null;
  var playing = false;
  var videoInput = 0;
  var noPicture = null;
  var retryTimer = null;
  var retryN = 0;
  /** when the picture last played; for the screen's details line: restarts, the last video event,
   *  and how often the app was hidden */
  var lastPlayingAt = 0;
  var restarts = 0;
  var lastEvent = "";
  var hides = 0;
  var releaseTimer = null;
  /** said under the buttons: no picture from the input */
  var pictureNote = "";

  function listInputs() {
    luna("luna://com.webos.service.eim/getAllInputStatus", {}, function (r) {
      var list = [];
      var devices = (r && (r.devices || r.inputSourceList)) || [];
      for (var i = 0; i < devices.length; i++) {
        var d = devices[i];
        var m = d && typeof d.appId === "string" && d.appId.match(/hdmi(\d)$/i);
        if (!m) continue;
        var port = "HDMI " + m[1];
        var name = d.label && d.label !== port ? port + " (" + d.label + ")" : port;
        list.push({ n: Number(m[1]), label: name });
      }
      inputs = list;
      render();
    });
  }

  function playInputs() {
    if (inputs.length) return inputs;
    var list = [];
    for (var n = 1; n <= 4; n++) list.push({ n: n, label: "HDMI " + n });
    return list;
  }

  /** Play on: the input the console is on (kept: the app starts with it next time). */
  function pickPlayOn() {
    var list = playInputs();
    var last = Number(load("play_hdmi")) || 0;
    var names = [];
    var checked = 0;
    for (var i = 0; i < list.length; i++) {
      names.push(list[i].label);
      if (list[i].n === last) checked = i;
    }
    openPicker(t("play_on").replace(/[\s…:.]+$/, ""), names, checked, function (which) {
      var n = list[which].n;
      save("play_hdmi", String(n));
      pictureNote = "";
      play(n);
      hidePanel();
    });
  }

  /** The game from HDMI input n (a new video). `again`: a retry after the picture failed. */
  function play(n, again) {
    stopVideo(again);
    videoInput = n;
    var v = document.createElement("video");
    v.autoplay = true;
    v.setAttribute("autoplay", "");
    // exactly the window's size, inline: webOS counts only a video filling the screen as playing (one
    // that doesn't can let the screen saver in, as YouTube's webOS app found)
    v.style.left = "0px";
    v.style.top = "0px";
    v.style.width = (window.innerWidth || 1920) + "px";
    v.style.height = (window.innerHeight || 1080) + "px";
    var src = document.createElement("source");
    src.setAttribute("type", "service/webos-external");
    src.setAttribute("src", "ext://hdmi:" + n);
    v.appendChild(src);
    ["playing", "error", "abort", "emptied", "ended", "stalled", "waiting"].forEach(function (name) {
      v.addEventListener(name, function () {
        onVideo(v, name);
      });
    });
    $("stage").appendChild(v);
    video = v;
    try {
      v.load();
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {
      // (the events say what happened)
    }
    // (from the first try: retries don't put it off)
    if (!again) {
      clearTimeout(noPicture);
      noPicture = setTimeout(function () {
        noPicture = null;
        if (!playing) onNoPicture();
      }, NO_PICTURE_MS);
    }
  }

  function onVideo(v, name) {
    if (v !== video) return;
    lastEvent = name;
    if (name === "playing") {
      playing = true;
      lastPlayingAt = Date.now();
      retryN = 0;
      clearTimeout(noPicture);
      pictureNote = "";
      awake(!document.hidden);
      render();
      return;
    }
    // (stalled and waiting come now and then while the picture runs fine: nothing to do)
    if (FAILED[name] && !retryTimer) {
      var failedAt = Date.now();
      retryTimer = setTimeout(function () {
        retryTimer = null;
        if (video !== v || document.hidden) return;
        if (lastPlayingAt > failedAt) return; // back by itself
        restarts++;
        retryN++;
        playing = false;
        awake(false);
        play(videoInput, true);
      }, VIDEO_RETRY_MS[Math.min(retryN, VIDEO_RETRY_MS.length - 1)]);
    }
  }

  /** "HDMI 2 · restarts 3 · emptied · hidden 1×": what the picture did, for a player's report. */
  function details() {
    if (!videoInput) return "";
    var saver = awake.stats();
    return (
      "HDMI " + videoInput + " · restarts " + restarts + (lastEvent ? " · " + lastEvent : "") + (hides ? " · hidden " + hides + "×" : "") +
      " · saver " + saver.answered + "/" + saver.asked + (saver.reg && saver.reg !== "ok" ? " (" + saver.reg + ")" : "")
    );
  }

  function onNoPicture() {
    pictureNote = t("no_picture", "HDMI " + videoInput);
    showPanel();
    focused = "playOn";
    render();
  }

  /** The HDMI picture let go (another app in front, or Back to leave). `again`: for a retry. */
  function stopVideo(again) {
    if (!again) {
      clearTimeout(noPicture);
      noPicture = null;
    }
    clearTimeout(retryTimer);
    retryTimer = null;
    playing = false;
    awake(false);
    var v = video;
    video = null;
    if (v) {
      try {
        v.pause();
        v.removeAttribute("src");
        while (v.firstChild) v.removeChild(v.firstChild);
        v.load();
      } catch (e) {
        // (gone)
      }
      if (v.parentNode) v.parentNode.removeChild(v);
    }
  }

  // ---- in front, behind, opened again ----------------------------------------------------------

  /** In front again: the game back if it was on, the PC asked at once. */
  function resume() {
    clearTimeout(releaseTimer);
    releaseTimer = null;
    var n = Number(load("play_hdmi")) || 0;
    if (connected() && n && !video) play(n);
    else if (video && playing) awake(true);
    if (connected()) check();
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      resume();
      return;
    }
    hides++;
    // behind another app or the TV's menu: the screen saver may come; a short menu keeps the picture
    awake(false);
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(function () {
      releaseTimer = null;
      if (document.hidden) stopVideo();
    }, RELEASE_HIDDEN_MS);
  });

  // opened again while it runs (from the launcher or the TV's app list): to the front, as it was
  document.addEventListener("webOSRelaunch", function () {
    if (sys && typeof sys.activate === "function") {
      try {
        sys.activate();
      } catch (e) {
        // (already in front)
      }
    }
    resume();
    if (!video || !playing) showPanel();
  });

  // ---- start ------------------------------------------------------------------------------

  readLocale();
  readTvName(function () {
    startPairing();
    render();
  });
  listInputs();
  // connected, with the console's input known: straight to the game
  var startInput = Number(load("play_hdmi")) || 0;
  if (connected() && startInput) {
    hidePanel();
    play(startInput);
  } else {
    showPanel();
  }
  if (connected()) startOverlay();
})();
