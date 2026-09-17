import fs from "fs";
import path from "path";
import dotenv from "dotenv";

if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
}

// Docker/Kubernetes secrets mount as one file per secret; expose each as an env var named after the file.
const secretsDir = process.env.SECRETS_DIR;
if (secretsDir) {
  for (const name of fs.readdirSync(secretsDir)) {
    if (name.startsWith(".") || process.env[name] !== undefined) continue;
    const file = path.join(secretsDir, name);
    if (!fs.statSync(file).isFile()) continue;
    process.env[name] = fs.readFileSync(file, "utf8").trimEnd();
  }
}
