// Prepares the script tag bundles for our CDN.
// Usage: node scripts/stage-script-cdn.js <output directory>
//
// Copies dist/script into the output directory, plus:
// - A copy of each bundle under every ordering of its features, so that
//   core-visual-redirects.min.js works as well as core-redirects-visual.min.js.
//   The copies share the original's source map.
// - A VERSION file with the SDK version.

const fs = require("fs");
const path = require("path");
const { version } = require("../package.json");

const src = path.resolve(__dirname, "../dist/script");
const out = process.argv[2];
if (!out) {
  console.error("Usage: node scripts/stage-script-cdn.js <output directory>");
  process.exit(1);
}
if (!fs.existsSync(path.join(src, "core.min.js"))) {
  console.error("No bundles in dist/script. Run `pnpm build:bundles` first.");
  process.exit(1);
}

function orderings(items) {
  if (items.length < 2) return [items];
  return items.flatMap((item, i) =>
    orderings(items.filter((_, j) => j !== i)).map((rest) => [item, ...rest]),
  );
}

fs.mkdirSync(out, { recursive: true });
for (const file of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, file), path.join(out, file));
  if (!file.endsWith(".min.js")) continue;
  // "core-redirects-visual.min.js" has the features ["redirects", "visual"]
  const features = file.slice(0, -".min.js".length).split("-").slice(1);
  for (const order of orderings(features)) {
    const name = ["core", ...order].join("-") + ".min.js";
    fs.copyFileSync(path.join(src, file), path.join(out, name));
  }
}
fs.writeFileSync(path.join(out, "VERSION"), version + "\n");
