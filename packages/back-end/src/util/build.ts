// Warning: This is called from init/instrumentation.ts.
// Careful importing other modules, as they and any dependencies they import won't be instrumented.
import path from "path";
import fs from "fs";

let build: { sha: string; date: string; lastVersion: string };
export function getBuild() {
  if (!build) {
    build = {
      sha: "",
      date: "",
      lastVersion: "",
    };
    const rootPath = path.join(__dirname, "..", "..", "..", "..", "buildinfo");
    if (fs.existsSync(path.join(rootPath, "SHA"))) {
      build.sha = fs.readFileSync(path.join(rootPath, "SHA")).toString().trim();
    }
    if (fs.existsSync(path.join(rootPath, "DATE"))) {
      build.date = fs
        .readFileSync(path.join(rootPath, "DATE"))
        .toString()
        .trim();
    }

    // Read version from package.json
    try {
      const packageJSONPath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "package.json",
      );
      if (fs.existsSync(packageJSONPath)) {
        const json = JSON.parse(fs.readFileSync(packageJSONPath).toString());
        build.lastVersion = json.version;
      }
    } catch (e) {
      // Ignore errors here, not important
    }
  }

  return build;
}
