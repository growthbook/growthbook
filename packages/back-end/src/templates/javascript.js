/* eslint-disable */
(function () {
  if (location.search.match(/\bgrowthbookVisualDesigner\b/)) {
    window.EXP_PLATFORM_ORIGIN = "{{APP_ORIGIN}}";
    const s = document.createElement("script");s.async = true;s.src =
      "https://unpkg.com/ab-designer@0.4.0/dist/ab-designer.cjs.production.min.js"; document.head.appendChild(s);
    return;
  }

  const mutate = (function() {
var t=/^[a-zA-Z:_][a-zA-Z0-9:_.-]*$/,e={revert:function(){}},n=new Map,r=new Set;function u(t){var e=n.get(t);return e||(e={el:t,attributes:{}},n.set(t,e)),e}function i(t,e,n,r,u){var i=n(t),a={isDirty:!1,originalValue:i,virtualValue:i,mutations:[],el:t,observer:new MutationObserver((function(){var e=n(t);e!==a.virtualValue&&(a.originalValue=e,u(a))})),runMutations:u,setValue:r,getCurrentValue:n};return a.observer.observe(t,function(t){return"html"===t?{childList:!0,subtree:!0,attributes:!0,characterData:!0}:{childList:!1,subtree:!1,attributes:!0,attributeFilter:[t]}}(e)),a}function a(t){var e=t.originalValue;return t.mutations.forEach((function(t){return e=t.mutate(e)})),e}function s(t,e){var n=e.getCurrentValue(e.el);e.virtualValue=t,t!==n&&(e.isDirty=!0,V||(V=!0,requestAnimationFrame(k)))}function o(t){s(function(t){v||(v=document.createElement("div"));return v.innerHTML=t,v.innerHTML}(a(t)),t)}function l(t){var e=function(t,e){return e.mutations.forEach((function(e){return e.mutate(t)})),t}(new Set(t.originalValue.split(/\s+/).filter(Boolean)),t);s(Array.from(e).filter(Boolean).join(" "),t)}function c(t){s(a(t),t)}var f=function(t){return t.innerHTML},m=function(t,e){return t.innerHTML=e};function d(t){var e=u(t);return e.html||(e.html=i(t,"html",f,m,o)),e.html}var v,b=function(t,e){return e?t.className=e:t.removeAttribute("class")},h=function(t){return t.className};function p(t){var e=u(t);return e.classes||(e.classes=i(t,"class",h,b,l)),e.classes}function M(t,e){var n=u(t);return n.attributes[e]||(n.attributes[e]=i(t,e,(function(t){return t.getAttribute(e)||""}),(function(t,n){return n?t.setAttribute(e,n):t.removeAttribute(e)}),c)),n.attributes[e]}function w(t,e,r){if(r.isDirty){r.isDirty=!1;var u=r.virtualValue;r.mutations.length||function(t,e){var r,u,i=n.get(t);if(i)if("html"===e)null==(r=i.html)||null==(u=r.observer)||u.disconnect(),delete i.html;else if("class"===e){var a,s;null==(a=i.classes)||null==(s=a.observer)||s.disconnect(),delete i.classes}else{var o,l,c;null==(o=i.attributes)||null==(l=o[e])||null==(c=l.observer)||c.disconnect(),delete i.attributes[e]}}(t,e),r.setValue(t,u)}}var y,V=!1;function g(t,e){t.html&&w(e,"html",t.html),t.classes&&w(e,"class",t.classes),Object.keys(t.attributes).forEach((function(n){w(e,n,t.attributes[n])}))}function k(){V=!1,n.forEach(g)}function A(t,e){if(t.elements.delete(e),"html"===t.kind){var n=d(e),r=n.mutations.indexOf(t);-1!==r&&n.mutations.splice(r,1),n.runMutations(n)}else if("class"===t.kind){var u=p(e),i=u.mutations.indexOf(t);-1!==i&&u.mutations.splice(i,1),u.runMutations(u)}else if("attribute"===t.kind){var a=M(e,t.attribute),s=a.mutations.indexOf(t);-1!==s&&a.mutations.splice(s,1),a.runMutations(a)}}function E(t){var e=new Set(t.elements),n=new Set;document.body.querySelectorAll(t.selector).forEach((function(r){n.add(r),e.has(r)||function(t,e){if(t.elements.add(e),"html"===t.kind){var n=d(e);n.mutations.push(t),n.runMutations(n)}else if("class"===t.kind){var r=p(e);r.mutations.push(t),r.runMutations(r)}else if("attribute"===t.kind){var u=M(e,t.attribute);u.mutations.push(t),u.runMutations(u)}}(t,r)})),e.forEach((function(e){n.has(e)||A(t,e)}))}function S(){r.forEach(E)}function L(t){return"undefined"==typeof document?e:(r.add(t),E(t),{revert:function(){var e;e=t,new Set(e.elements).forEach((function(t){A(e,t)})),e.elements.clear(),r.delete(e)}})}function D(t,e){return L({kind:"html",elements:new Set,mutate:e,selector:t})}function O(t,e){return L({kind:"class",elements:new Set,mutate:e,selector:t})}function H(n,r,u){return t.test(r)?L("class"===r||"className"===r?{kind:"class",elements:new Set,mutate:function(t){var e=u(Array.from(t).join(" "));t.clear(),e.split(/\s+/g).filter(Boolean).forEach((function(e){t.add(e)}))},selector:n}:{kind:"attribute",attribute:r,elements:new Set,mutate:u,selector:n}):e}return"undefined"!=typeof document&&(y||(y=new MutationObserver((function(){S()}))),S(),y.observe(document.body,{childList:!0,subtree:!0,attributes:!1,characterData:!1})),{html:D,classes:O,attribute:H,declarative:function(t){var n=t.selector,r=t.action,u=t.value,i=t.attribute;if("html"===i){if("append"===r)return D(n,(function(t){return t+u}));if("set"===r)return D(n,(function(){return u}))}else if("class"===i){if("append"===r)return O(n,(function(t){return t.add(u)}));if("remove"===r)return O(n,(function(t){return t.delete(u)}));if("set"===r)return O(n,(function(t){t.clear(),t.add(u)}))}else{if("append"===r)return H(n,i,(function(t){return t+u}));if("set"===r)return H(n,i,(function(){return u}))}return e}}
  })();
  function injectStyles(css) {var s = document.createElement("style");s.innerHTML = css;document.head.appendChild(s);}

  const config = window.GROWTHBOOK_CONFIG;
  if (!config) {
    console.error("window.GROWTHBOOK_CONFIG must be defined");
  }
  function generateAnonId() {
    const k = "GROWTHBOOK_ANONID";
    try {
      let id = localStorage.getItem(k);
      if (!id) {
        id = Math.floor(Math.random() * 1000000);
        localStorage.setItem(k, id);
      }
      return id;
    } catch (e) {
      return "";
    }
  }
  function hashFnv32a(str) {
    let hval = 0x811c9dc5;
    const l = str.length;
    for (let i = 0; i < l; i++) {
      hval ^= str.charCodeAt(i);
      hval +=
        (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
    }
    return hval >>> 0;
  }
  const uid = config.userId || config.anonId || generateAnonId();
  if (!uid) {
    console.error("No userId or anonId set, skipping all experiments.");
    return;
  }
  const g = config.groups || [];
  const t = config.track || console.log;
  function choose(k, w, f) {
    if (f >= 0) return f;
    const n = (hashFnv32a(uid + k) % 1000) / 1000;
    let c = 0;
    for (let i = 0; i < w.length; i++) {
      c += w[i];
      if (n < c) return i;
    }
    return -1;
  }
  function included(o) {
    if (o.g && !o.g.filter((n) => g.includes(n)).length) return 0;
    if (o.u && !location.href.match(new RegExp(o.u))) return 0;
    return 1;
  }
  function run(k, v, o) {
    if (!included(o)) return;
    const i = choose(k, o.w, o.f);
    if (!v[i]) return;
    v[i]();
    t(k, i);
  }
  // Experiments
  /*BEGIN_EXPERIMENTS*/
  run(
    // Tracking key
    "my-experiment",
    // Array of variation functions
    [
      function () {
        console.log("control");
      },
      function () {
        console.log("variation");
      },
    ],
    {
      // Variation weighting
      w: [0.5, 0.5],
      // Force a specific variation
      f: -1,
      // Limit to specific user groups
      g: ["internal", "qa"],
      // Limit to specific URLs
      u: "^/post/[0-9]+",
    }
  );
  /*END_EXPERIMENTS*/
})();
