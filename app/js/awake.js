/*
 * Keeps the TV awake while the game plays in the app. The game's HDMI picture inside the app doesn't
 * count as "playing" for webOS, so without this the screen saver starts after some minutes without a
 * remote key (the game is played on the console's controller), and some TVs then blank the screen.
 * The layer webOS itself documents is in app/appinfo.json, not here: "screenSaverProperties"
 * {"preferredType": 2} (OLED, webOS 5 and newer: an app with text over video; the screen saver waits
 * 30 minutes and then only dims the text, never the picture) and "enablePigScreenSaver": false (LG's
 * answer for a video webOS doesn't count as full screen, as the HDMI input in an app can be). LG says
 * a full-screen video is the only other thing that keeps the screen saver away; webOS 6 has no
 * screen-saver off switch. The layers below are tried on top, each one quietly (a TV that refuses
 * one keeps the others):
 *
 * - screen saver: the TV's power service asks its clients before it starts the screen saver
 *   (registerScreenSaverRequest, subscribed); each request (a reply with a timestamp: webOS 4 sends
 *   no "state", others "Active") is answered no at once, the timestamp sent back exactly as it came
 *   (the TV waits about 3 seconds). The client name is new on every start (a TV can keep an older
 *   page's name). The request is registered again every 10 minutes, and when the TV doesn't answer
 *   within 10 seconds, since a TV may drop the subscription without a word;
 * - wake lock: the page's Screen Wake Lock, where the TV's browser has it (taken again when the app
 *   shows again: the browser lets it go while hidden);
 * - screen back on: the TV's power state is watched; if the screen goes off while the game plays,
 *   the screen is asked back (at most 3 times per screen-off, 20 seconds apart, so a screen the
 *   viewer turned off on purpose stays off; never from standby: the app never turns a TV on).
 *
 * awake(on): wanted or not (the game's picture plays and the app is in front).
 * awake.stats(): {asked, answered, reg}: the TV's screen-saver requests, the "no" answers it took,
 * and how the registration went ("" not yet, "ok", or the TV's error code/text), for the screen's
 * details line (a player's report tells whether the TV refuses the call or just never asks).
 */
(function (root) {
  "use strict";

  var POWER = "luna://com.webos.service.tvpower/power/";
  /** new on every start: a TV may keep the name an older page registered */
  var CLIENT = "app.vitranslator.tv." + Date.now().toString(36);
  var REREGISTER_MS = 10 * 60000;
  var NO_ANSWER_MS = 10000;
  var SCREEN_ON_EVERY_MS = 20000;
  var SCREEN_ON_TRIES = 3;
  /** the power states where the screen is off but the TV is on (never "Active Standby": the TV is off) */
  var SCREEN_OFF = /screen ?off|screen ?saver/i;

  var wanted = false;
  var saver = null; // the screen-saver subscription
  var saverAnswered = false;
  var reregister = null;
  var noAnswer = null;
  var lock = null;
  var power = null; // the power-state subscription
  var screenOnTries = 0;
  var lastScreenOn = 0;
  var asked = 0;
  var answered = 0;
  var reg = "";
  /** the answers on their way (each on its own bridge, kept until the TV replies) */
  var answers = [];

  function call(uri, params, cb) {
    try {
      return root.luna(uri, params, cb || function () {});
    } catch (e) {
      return null;
    }
  }

  function cancel(sub) {
    if (!sub) return;
    try {
      sub.cancel();
    } catch (e) {
      // (gone)
    }
  }

  // ---- the screen saver ------------------------------------------------------------------------

  function registerSaver() {
    cancel(saver);
    saver = null;
    saverAnswered = false;
    clearTimeout(noAnswer);
    if (!wanted) return;
    var mine = call(POWER + "registerScreenSaverRequest", { clientName: CLIENT, subscribe: true }, function (r) {
      if (saver !== mine || !r) return; // (an older subscription)
      saverAnswered = true;
      if (r.returnValue === false) {
        // refused (a TV that doesn't let this app ask): said on the details line; tried again in 10 minutes
        reg = String(r.errorCode !== undefined ? r.errorCode : r.errorText || "refused").slice(0, 24);
        return;
      }
      if (reg !== "ok") reg = "ok";
      if (r.timestamp === undefined || r.timestamp === null || r.state === "Inactive") return;
      // not now: the game is on (the timestamp as it came: a string on some TVs, a number on others)
      asked++;
      var a = call(POWER + "responseScreenSaverRequest", { clientName: CLIENT, ack: false, timestamp: r.timestamp }, function (res) {
        if (res && res.returnValue !== false) answered++;
        var i = answers.indexOf(a);
        if (i >= 0) answers.splice(i, 1);
      });
      if (a) answers.push(a);
      if (answers.length > 8) answers.shift();
    });
    saver = mine;
    // no answer at all: the TV may have dropped it; registered again
    noAnswer = setTimeout(function () {
      if (wanted && !saverAnswered) registerSaver();
    }, NO_ANSWER_MS);
  }

  // ---- the wake lock ---------------------------------------------------------------------------

  function takeLock() {
    var wl = root.navigator && root.navigator.wakeLock;
    if (!wanted || lock || !wl || typeof wl.request !== "function") return;
    try {
      wl.request("screen").then(
        function (l) {
          if (!wanted) {
            l.release();
            return;
          }
          lock = l;
          l.addEventListener("release", function () {
            if (lock === l) lock = null;
          });
        },
        function () {
          // (refused: the other layers hold)
        }
      );
    } catch (e) {
      // (not on this TV)
    }
  }

  function dropLock() {
    var l = lock;
    lock = null;
    if (l) {
      try {
        l.release();
      } catch (e) {
        // (gone)
      }
    }
  }

  // ---- the screen back on ------------------------------------------------------------------------

  function watchPower() {
    if (power || !wanted) return;
    power = call(POWER + "getPowerState", { subscribe: true }, function (r) {
      if (!r || typeof r.state !== "string") return;
      if (!SCREEN_OFF.test(r.state)) {
        screenOnTries = 0; // (on again: the next screen-off gets its own tries)
        return;
      }
      var now = Date.now();
      if (!wanted || screenOnTries >= SCREEN_ON_TRIES || now - lastScreenOn < SCREEN_ON_EVERY_MS) return;
      screenOnTries++;
      lastScreenOn = now;
      call(POWER + "turnOnScreen", {});
    });
  }

  function stopPower() {
    cancel(power);
    power = null;
    screenOnTries = 0;
  }

  // ---- on and off ------------------------------------------------------------------------------

  function awake(on) {
    on = !!on;
    if (on === wanted) {
      if (on) takeLock(); // (taken again after the page was hidden)
      return;
    }
    wanted = on;
    clearInterval(reregister);
    reregister = null;
    if (on) {
      registerSaver();
      reregister = setInterval(registerSaver, REREGISTER_MS);
      takeLock();
      watchPower();
    } else {
      clearTimeout(noAnswer);
      cancel(saver);
      saver = null;
      dropLock();
      stopPower();
    }
  }

  awake.stats = function () {
    return { asked: asked, answered: answered, reg: reg };
  };

  root.awake = awake;
})(window);
