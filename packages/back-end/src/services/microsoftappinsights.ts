import https from "https";
import fetch from "node-fetch";

import { MicrosoftAppInsightsParams } from "../../types/integrations/microsoftappinsights";

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

export async function runApi(
  conn: MicrosoftAppInsightsParams,
  urlQuery: string
) {
  let data = null;

  const url = `https://api.applicationinsights.io/v1/apps/${conn.appId}/query${urlQuery}`;
  const res = await fetch(url, {
    agent: httpsAgent,
    headers: {
      ["x-api-key"]: conn.apiKey,
    },
  });
  data = await res.json();

  if (data.error) {
    throw new Error(data.error.message);
  }
  return data;
}
