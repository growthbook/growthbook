// Import package.json in this project and bump the version
// Usage: node scripts/bump-version.js patch

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const packageJson = require("../package.json");

// Get type of version bump from the script input
const type = process.argv[2];

if (!type) {
  console.error("Error: Version bump type is required (major, minor, or patch)");
  process.exit(1);
}

const version = packageJson.version.split(".");
let major = parseInt(version[0]);
let minor = parseInt(version[1]);
let patch = parseInt(version[2]);

switch (type) {
  case "major":
    major++;
    minor = 0;
    patch = 0;
    break;
  case "minor":
    minor++;
    patch = 0;
    break;
  case "patch":
    patch++;
    break;
  default:
    console.error("Invalid version bump type (allowed: major, minor, patch)", type);
    process.exit(1);
}

const newVersion = `${major}.${minor}.${patch}`;

console.log(`New version: ${newVersion}`);

// Bump this own package.json version
console.log("Bumping version in packages/sdk-js/package.json");
packageJson.version = newVersion;
fs.writeFileSync(
  path.resolve(__dirname, "../package.json"),
  JSON.stringify(packageJson, null, 2) + "\n",
);

// Bump version in back-end package.json
console.log("Bumping dependency in packages/back-end/package.json");
const backendPackageJson = require("../../back-end/package.json");
backendPackageJson.dependencies["@growthbook/growthbook"] = `^${newVersion}`;
fs.writeFileSync(
  path.resolve(__dirname, "../../back-end/package.json"),
  JSON.stringify(backendPackageJson, null, 2) + "\n",
);

// Bump version in shared package.json
console.log("Bumping dependency in packages/shared/package.json");
const sharedPackageJson = require("../../shared/package.json");
sharedPackageJson.dependencies["@growthbook/growthbook"] = `^${newVersion}`;
fs.writeFileSync(
  path.resolve(__dirname, "../../shared/package.json"),
  JSON.stringify(sharedPackageJson, null, 2) + "\n",
);

// Bump both version and dependency in sdk-react package
console.log(
  "Bumping version and dependency in packages/sdk-react/package.json",
);
const sdkReactPackageJson = require("../../sdk-react/package.json");
sdkReactPackageJson.version = newVersion;
sdkReactPackageJson.dependencies["@growthbook/growthbook"] = `^${newVersion}`;
fs.writeFileSync(
  path.resolve(__dirname, "../../sdk-react/package.json"),
  JSON.stringify(sdkReactPackageJson, null, 2) + "\n",
);

// Bump react dependency in front-end package
console.log("Bumping dependency in packages/front-end/package.json");
const frontendPackageJson = require("../../front-end/package.json");
frontendPackageJson.dependencies["@growthbook/growthbook-react"] =
  `^${newVersion}`;
fs.writeFileSync(
  path.resolve(__dirname, "../../front-end/package.json"),
  JSON.stringify(frontendPackageJson, null, 2) + "\n",
);

// Update override in top-level package.json
console.log("Updating override in top-level package.json");
const topLevelPackageJson = require("../../../package.json");
if (!topLevelPackageJson.pnpm) {
  topLevelPackageJson.pnpm = {};
}
if (!topLevelPackageJson.pnpm.overrides) {
  topLevelPackageJson.pnpm.overrides = {};
}
topLevelPackageJson.pnpm.overrides["@growthbook/growthbook"] = newVersion;
fs.writeFileSync(
  path.resolve(__dirname, "../../../package.json"),
  JSON.stringify(topLevelPackageJson, null, 2) + "\n",
);

// Add entry to beginning of packages/shared/src/sdk-versioning/sdk-versions/javascript.json
console.log(
  "Updating packages/shared/src/sdk-versioning/sdk-versions/javascript.json",
);
const sdkVersions = require("../../shared/src/sdk-versioning/sdk-versions/javascript.json");
sdkVersions.versions.unshift({
  version: newVersion,
});
fs.writeFileSync(
  path.resolve(
    __dirname,
    "../../shared/src/sdk-versioning/sdk-versions/javascript.json",
  ),
  JSON.stringify(sdkVersions, null, 2) + "\n",
);

// Add entry to `node.json`
console.log(
  "Updating packages/shared/src/sdk-versioning/sdk-versions/nodejs.json",
);
const nodeVersions = require("../../shared/src/sdk-versioning/sdk-versions/nodejs.json");
nodeVersions.versions.unshift({
  version: newVersion,
});
fs.writeFileSync(
  path.resolve(
    __dirname,
    "../../shared/src/sdk-versioning/sdk-versions/nodejs.json",
  ),
  JSON.stringify(nodeVersions, null, 2) + "\n",
);

// Add entry to `react.json`
console.log(
  "Updating packages/shared/src/sdk-versioning/sdk-versions/react.json",
);
const reactVersions = require("../../shared/src/sdk-versioning/sdk-versions/react.json");
reactVersions.versions.unshift({
  version: newVersion,
});
fs.writeFileSync(
  path.resolve(
    __dirname,
    "../../shared/src/sdk-versioning/sdk-versions/react.json",
  ),
  JSON.stringify(reactVersions, null, 2) + "\n",
);

// Run prettier to format the JSON files properly
exec(
  "pnpm prettier --write ../shared/src/sdk-versioning/sdk-versions/{javascript,nodejs,react}.json",
  (err, stdout, stderr) => {
    console.log("Running prettier to format JSON files");
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(stdout);
  },
);

// Generate a new SDK report
exec("pnpm --filter shared generate-sdk-report", (err, stdout, stderr) => {
  console.log("Generating new SDK report");
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(stdout);
});

// Update docs SDKInfo.ts
exec("cd ../../docs && pnpm gen-sdk-resources", (err, stdout, stderr) => {
  console.log("Updating docs SDKInfo.ts");
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(stdout);
});
