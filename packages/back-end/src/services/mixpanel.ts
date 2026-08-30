import { Agent } from "node:https";
import { URLSearchParams } from "url";
import { MixpanelConnectionParams } from "shared/types/integrations/mixpanel";
import { fetch } from "back-end/src/util/http.util";

const encodedParams = new URLSearchParams();

// node-fetch v2 reuses keep-alive sockets via Node's global Agent. Node 24.17.0's
// http.Agent change (CVE-2026-48931) makes it read a pooled socket the server has
// already closed, surfacing as "FetchError: ... Premature close"
// (ERR_STREAM_PREMATURE_CLOSE). JQL requests are infrequent, so disabling
// keep-alive here sidesteps the stale-socket reuse with no meaningful cost.
// Ref: https://github.com/nodejs/node/issues/63989
const jqlAgent = new Agent({ keepAlive: false });

// eslint-disable-next-line
type MixpanelResultRow = any;

function indentJs(js: string) {
  let indent = 0;
  return (
    js
      // Get rid of existing indentation
      .replace(/^\s+/gm, "")
      // Split into lines
      .split(/\n/g)
      // Add new indentation
      .map((line) => {
        // Remove an indent when the line closes a block.  e.g. ");" or "}))];" or "],"
        if (line.match(/^[})\]\s]+[;,]?\s*$/)) indent--;
        line = "  ".repeat(Math.max(0, indent)) + line;
        // Add an indent when the line starts a block. e.g. "if(...) {" or "const a = ["
        if (line.match(/[{([]+\s*$/)) indent++;
        return line;
      })
      // Combine back to a single string
      .join("\n")
      // Remove excessive consecutive newlines
      .replace(/\n[ ]*\n[ ]*\n/g, "\n\n")
      // Remove leading and trailing whitespace
      .trim()
  );
}

export function formatQuery(
  js: string,
  params?: Record<string, unknown>,
  extraJs?: string,
) {
  return indentJs(`
    ${params ? `var params = ${JSON.stringify(params, null, 2)};` : ""}
    ${extraJs ? extraJs : ""}
    function main() {
      ${js}
    }
  `);
}

export async function runQuery<T extends MixpanelResultRow>(
  conn: MixpanelConnectionParams,
  query: string,
): Promise<T> {
  encodedParams.set("script", query);
  encodedParams.set("project_id", conn.projectId);

  const apiBase =
    conn.server === "eu" ? "eu.mixpanel.com/api" : "mixpanel.com/api";

  const url = `https://${apiBase}/2.0/jql`;

  const options = {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Mixpanel-Integration-ID": "growthbook",
      Authorization: `Basic ${Buffer.from(
        `${conn.username}:${conn.secret}`,
      ).toString("base64")}`,
    },
    body: encodedParams,
    agent: jqlAgent,
  };

  const res = await fetch(url, options);
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error);
  }
  return json;
}
