import babel from "@rollup/plugin-babel";
import resolve from "@rollup/plugin-node-resolve";
import { terser } from "rollup-plugin-terser";
import replace from "@rollup/plugin-replace";

const extensions = [".js", ".ts"];

// TODO: add more auto-attributes like browser, deviceType, UTM params
// TODO: poll for URL changes and call `setUrl()`
const autoScript = `(()=>{
  const getUUID = () => {
    const COOKIE_NAME = "gbuuid";
    const COOKIE_DAYS = 400; // 400 days is the max cookie duration for chrome
  
    // use the browsers crypto.randomUUID if set
    const genUUID = () => {
      if(window?.crypto?.randomUUID) return window.crypto.randomUUID();
      return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
      );
    }
    const getCookie = (name) => {
      let value = \`; \${document.cookie}\`;
      let parts = value.split(\`; \${name}=\`);
      if (parts.length === 2) return parts.pop().split(';').shift();
    }
    const setCookie = (name, value) => {
      var d = new Date();
      d.setTime(d.getTime() + 24*60*60*1000*COOKIE_DAYS);
      document.cookie = name + "=" + value + ";path=/;expires=" + d.toGMTString();
    }
  
    // get the existing UUID from cookie if set, otherwise create one and store it in the cookie
    if(getCookie(COOKIE_NAME)) return getCookie(COOKIE_NAME);
    
    const uuid = genUUID();
    setCookie(COOKIE_NAME, uuid);
    return uuid;
  }
  var dataContext=document.currentScript.dataset;
  var windowContext=window.growthbook_config||{};
  window.dataLayer=window.dataLayer||[];
  var gb=new growthbook({
    ...dataContext,
    attributes:!windowContext.attributes?{id:getUUID()}:{},
    remoteEval:!!dataContext.remoteEval,
    subscribeToChanges: true,
    trackingCallback:(e,r)=>{
      var p={experiment_id:e.key,variation_id:r.key};
      window.dataLayer.push(['event','experiment_viewed',p]);
      window.analytics&&window.analytics.track&&window.analytics.track("Experiment Viewed",p);
    },
    ...windowContext
  });
  gb.loadFeatures();
  window._growthbook=gb;
})();`;

const terserSettings = terser({
  output: { comments: false },
  compress: {
    keep_infinity: true,
    pure_getters: true,
    passes: 10,
  },
  mangle: {
    properties: {
      regex: /^_/,
    },
  },
  ecma: 5,
});

export default {
  input: "src/index.ts",
  external: () => false,
  output: [
    {
      file: "dist/bundles/esm.js",
      format: "esm",
      sourcemap: true,
    },
    {
      file: "dist/bundles/esm.min.js",
      format: "esm",
      plugins: [terserSettings],
      sourcemap: true,
    },
    {
      file: "dist/bundles/index.js",
      format: "iife",
      name: "growthbook",
      sourcemap: true,
    },
    {
      file: "dist/bundles/index.min.js",
      format: "iife",
      name: "growthbook",
      plugins: [terserSettings],
      sourcemap: true,
    },
    {
      file: "dist/bundles/auto.min.js",
      format: "iife",
      name: "growthbook",
      plugins: [terserSettings],
      sourcemap: true,
      footer: autoScript,
    },
  ],
  plugins: [
    resolve({ extensions, jsnext: true }),
    replace({
      "process.env.NODE_ENV": JSON.stringify("production"),
      preventAssignment: true,
    }),
    babel({
      babelHelpers: "bundled",
      extensions,
    }),
  ],
};
