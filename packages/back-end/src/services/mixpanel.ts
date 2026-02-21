import { URLSearchParams } from "url";
import { MixpanelConnectionParams } from "shared/types/integrations/mixpanel";
import { fetch } from "back-end/src/util/http.util";

const encodedParams = new URLSearchParams();

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
  };

  const res = await fetch(url, options);
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error);
  }
  return json;
}
