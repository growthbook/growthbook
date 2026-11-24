import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { version } from "../package.json";

// What this script writes is uploaded to a path that is never replaced
it("stages each bundle under every ordering of its features", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gb-script-cdn-"));
  const src = path.join(dir, "src");
  const out = path.join(dir, "out");
  fs.mkdirSync(src);
  for (const name of [
    "core",
    "core-redirects",
    "core-redirects-visual",
    "core-visual",
  ]) {
    fs.writeFileSync(path.join(src, `${name}.min.js`), name);
    fs.writeFileSync(path.join(src, `${name}.min.js.map`), "{}");
  }

  execFileSync(process.execPath, [
    path.join(__dirname, "../scripts/stage-script-cdn.js"),
    out,
    src,
  ]);

  expect(fs.readdirSync(out).sort()).toEqual([
    "VERSION",
    "core-redirects-visual.min.js",
    "core-redirects-visual.min.js.map",
    "core-redirects.min.js",
    "core-redirects.min.js.map",
    "core-visual-redirects.min.js",
    "core-visual.min.js",
    "core-visual.min.js.map",
    "core.min.js",
    "core.min.js.map",
  ]);
  // The other ordering is a copy of the bundle rollup built
  expect(
    fs.readFileSync(path.join(out, "core-visual-redirects.min.js"), "utf8"),
  ).toEqual("core-redirects-visual");
  expect(fs.readFileSync(path.join(out, "VERSION"), "utf8")).toEqual(
    version + "\n",
  );
  fs.rmSync(dir, { recursive: true });
});
