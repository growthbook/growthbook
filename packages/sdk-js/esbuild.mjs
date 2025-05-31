import { createRequire } from "module";
import { dirname, resolve } from "node:path";
import { readdir } from "node:fs/promises";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);
const { version } = require("./package.json");

const importExtensionsMjsPlugin = {
  name: "import-extensions-mjs",
  setup(build) {
    build.onResolve({ filter: /.*/ }, async (args) => {
      if (args.kind === "import-statement") {
        if (args.importer) {
          const path = args.path;

          const keepExisting = {
            path,
            external: true,
          };

          // If the import is not relative, leave it alone
          if (!path.match(/^\./)) {
            //console.log(path, "Not a relative import, leaving alone");
            return keepExisting;
          }

          const pathDir = dirname(resolve(args.resolveDir, path));
          const files = await readdir(pathDir);

          const filename = path.split("/").pop();

          // If the import is relative and the path exists, leave it alone
          if (files.includes(filename)) {
            //console.log(path, "Path exists, leaving alone");
            return keepExisting;
          }

          // If none of the files look like `path.{js-like-extension}, this is an error
          const jsLikeExtensions = [".js", ".mjs", ".ts", ".tsx", ".jsx"];
          const hasJsLikeExtension = files.some((file) => {
            return jsLikeExtensions.some((ext) => file === `${filename}${ext}`);
          });
          if (!hasJsLikeExtension) {
            throw new Error(
              "Js-like file not found: " + pathDir + "/" + filename
            );
          }

          // At this point, we can rewrite the import to have a mjs path
          //console.log(path, "Rewriting import to mjs extension");
          return {
            path: `${path}.mjs`,
            external: true,
          };
        }
      }
    });
  },
};

const bundleOptions = {
  sourcemap: true,
  define: {
    "process.env.NODE_ENV": '"production"',
    __SDK_VERSION__: JSON.stringify(version),
  },
  bundle: true,
  target: ["es2020"],
};

const rawOptions = {
  sourcemap: true,
  define: {
    __SDK_VERSION__: JSON.stringify(version),
  },
  entryPoints: ["src/**/*.ts"],
  // This is the only one used by Node, so want to make sure we go back to Node 16
  target: ["es2020", "node16"],
};

const minifyOptions = {
  minify: true,
  mangleProps: /^_/,
  legalComments: "none",
};

const autoWrapperOptions = {
  ...bundleOptions,
  entryPoints: ["src/auto-wrapper.ts"],
  globalName: "_growthbook",
  format: "iife",
};

const esmBundleOptions = {
  ...bundleOptions,
  entryPoints: ["src/index.ts"],
  format: "esm",
};

const indexBundleOptions = {
  ...bundleOptions,
  entryPoints: ["src/index.ts"],
  globalName: "growthbook",
  format: "iife",
};

await Promise.all([
  esbuild.build({
    ...autoWrapperOptions,
    outfile: "dist/bundles/auto.js",
  }),
  esbuild.build({
    ...autoWrapperOptions,
    ...minifyOptions,
    outfile: "dist/bundles/auto.min.js",
  }),
  esbuild.build({
    ...esmBundleOptions,
    outfile: "dist/bundles/esm.js",
  }),
  esbuild.build({
    ...esmBundleOptions,
    ...minifyOptions,
    outfile: "dist/bundles/esm.min.js",
  }),
  esbuild.build({
    ...indexBundleOptions,
    outfile: "dist/bundles/index.js",
  }),
  esbuild.build({
    ...indexBundleOptions,
    ...minifyOptions,
    outfile: "dist/bundles/index.min.js",
  }),
  esbuild.build({
    ...rawOptions,
    format: "esm",
    outdir: "dist/esm",
    outExtension: { ".js": ".mjs" },
    // bundle: true is required for the file path extensions plugin to work correctly
    // The code will not actually be bundled, but it needs to be set to true
    bundle: true,
    plugins: [importExtensionsMjsPlugin],
  }),
  esbuild.build({
    ...rawOptions,
    format: "cjs",
    outdir: "dist/cjs",
  }),
]);
