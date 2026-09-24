import { BigQuery, type BigQueryOptions } from "@google-cloud/bigquery";
import { normalizeBigQueryApiEndpoint } from "back-end/src/services/bigquery";
import { BadRequestError } from "back-end/src/util/errors";
import { IS_CLOUD, WEBHOOK_PROXY } from "back-end/src/util/secrets";

const DEFAULT_BIGQUERY_API_ENDPOINT = "https://bigquery.googleapis.com";

export function createBigQueryClient(options: BigQueryOptions): BigQuery {
  const apiEndpoint = normalizeBigQueryApiEndpoint(options.apiEndpoint);
  const customCloudEndpoint =
    IS_CLOUD && apiEndpoint && apiEndpoint !== DEFAULT_BIGQUERY_API_ENDPOINT;

  if (customCloudEndpoint) {
    if (new URL(apiEndpoint).protocol !== "https:") {
      throw new BadRequestError(
        "BigQuery API endpoints must use HTTPS on Cloud.",
      );
    }
    if (!WEBHOOK_PROXY) {
      throw new Error("Cloud custom BigQuery endpoints require WEBHOOK_PROXY.");
    }
  }

  const client = new BigQuery({ ...options, apiEndpoint });
  if (customCloudEndpoint) {
    client.interceptors.push({
      request: (request) => ({
        ...request,
        uri: "uri" in request ? request.uri : request.url,
        proxy: WEBHOOK_PROXY,
      }),
    });
  }
  return client;
}
