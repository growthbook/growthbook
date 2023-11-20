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

  const res = await fetch(
    `https://api.applicationinsights.io/v1/apps/${conn.appId}/query${urlQuery}`,
    {
      agent: httpsAgent,
      headers: {
        ["x-api-key"]: conn.apiKey,
      },
    }
  );
  data = await res.json();

  return data;
}
