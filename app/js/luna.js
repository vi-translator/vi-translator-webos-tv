/*
 * Calls to webOS services (the Luna bus), as webOSTV.js does them: through PalmServiceBridge.
 * luna(uri, params, onReply) calls once, or keeps sending replies when params.subscribe is true;
 * it returns a handle with cancel().
 *
 * In a desktop browser (no PalmServiceBridge), with ?dev=<address of tools/dev.mjs>, the calls go
 * to that test harness instead, which runs this app's service on the PC.
 */
var luna = (function () {
  var dev = (location.search.match(/[?&]dev=([^&]+)/) || [])[1];

  function bridge(uri, params, onReply) {
    var b;
    try {
      b = new PalmServiceBridge();
    } catch (e) {
      setTimeout(function () {
        onReply({ returnValue: false, errorText: "no PalmServiceBridge" });
      }, 0);
      return { cancel: function () {} };
    }
    b.onservicecallback = function (msg) {
      var r;
      try {
        r = JSON.parse(msg);
      } catch (e) {
        r = { returnValue: false, errorText: "bad reply" };
      }
      if (onReply) onReply(r);
    };
    b.call(uri, JSON.stringify(params || {}));
    // (the bridge has to stay referenced, or its subscription ends)
    return {
      bridge: b,
      cancel: function () {
        onReply = null;
        try {
          b.cancel();
        } catch (e) {
          // gone
        }
      },
    };
  }

  function harness(uri, params, onReply) {
    var url = decodeURIComponent(dev) + "/luna?uri=" + encodeURIComponent(uri) + "&params=" + encodeURIComponent(JSON.stringify(params || {}));
    var es = new EventSource(url);
    var once = !(params && params.subscribe);
    es.onmessage = function (e) {
      if (onReply) onReply(JSON.parse(e.data));
      if (once) es.close();
    };
    es.onerror = function () {
      es.close();
      if (onReply && once) onReply({ returnValue: false, errorText: "harness unreachable" });
    };
    return {
      cancel: function () {
        onReply = null;
        es.close();
      },
    };
  }

  return function (uri, params, onReply) {
    if (typeof PalmServiceBridge === "undefined" && dev) return harness(uri, params, onReply);
    return bridge(uri, params, onReply);
  };
})();
