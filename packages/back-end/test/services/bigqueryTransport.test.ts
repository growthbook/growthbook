import { execFileSync } from "node:child_process";
import path from "node:path";

it("the real BigQuery client requires its proxy, keeps redirects on it, and authenticates separately", () => {
  // A subprocess loads the real SDK and its ESM HTTP transport, which Jest stubs.
  execFileSync(
    process.execPath,
    [path.join(__dirname, "../fixtures/bigqueryTransport.mjs")],
    {
      cwd: path.join(__dirname, "../.."),
      timeout: 15_000,
      stdio: "pipe",
      // Explicit per-request proxying must work even with this bypass setting.
      env: {
        NO_PROXY: "*",
        DISABLE_PYTHON_MONITOR: "true",
        GOOGLE_CLOUD_PROJECT: "synthetic-project",
        NODE_EXTRA_CA_CERTS: path.join(
          __dirname,
          "../fixtures/bigqueryTransport.pem",
        ),
      },
    },
  );
});
