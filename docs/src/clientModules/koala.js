// eslint-disable-next-line import/no-unresolved
import ExecutionEnvironment from "@docusaurus/ExecutionEnvironment";

if (ExecutionEnvironment.canUseDOM) {
  void (function () {
    var k = "ko";
    var i = (window.globalKoalaKey = window.globalKoalaKey || k);
    if (window[i]) return;
    var ko = (window[i] = []);
    [
      "identify",
      "track",
      "removeListeners",
      "on",
      "off",
      "qualify",
      "ready",
    ].forEach(function (t) {
      ko[t] = function () {
        var n = [].slice.call(arguments);
        return n.unshift(t), ko.push(n), ko;
      };
    });
    var n = document.createElement("script");
    n.async = true;
    n.setAttribute(
      "src",
      "https://cdn.getkoala.com/v1/pk_a9a6d7213f4f4a9290a2f9bf161f016e8358/sdk.js"
    );
    (document.body || document.head).appendChild(n);
  })();
}
