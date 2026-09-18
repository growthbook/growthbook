import { BigQuery } from "@google-cloud/bigquery";
import { z } from "zod";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { fetch, getDataSourceHttpOptions } from "back-end/src/util/http.util";

const DISCOVERY_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_DATASETS = 1000;

export const bigQueryDatasetRequestSchema = z.object({
  projectId: z.string().optional(),
  client_email: z.string().optional(),
  private_key: z.string().optional(),
  datasourceId: z.string().optional(),
  projects: z.array(z.string()).optional(),
});

const connectionSchema = z.object({
  projectId: z.string().trim().min(1),
  clientEmail: z.string().trim().min(1),
  privateKey: z.string().min(1),
});

const datasetPageSchema = z.object({
  datasets: z
    .array(
      z.object({
        datasetReference: z.object({ datasetId: z.string().min(1) }),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
});

class DatasetDiscoveryError extends Error {}

export async function listBigQueryDatasets(
  params: Partial<BigQueryConnectionParams>,
) {
  const parsed = connectionSchema.safeParse(params);
  if (!parsed.success) {
    throw new Error(
      "BigQuery project ID, client email, and private key are required.",
    );
  }
  const { projectId, clientEmail, privateKey } = parsed.data;
  const credentials = { client_email: clientEmail, private_key: privateKey };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);

  try {
    const client = new BigQuery({ projectId, credentials });
    const auth = client.authClient.fromJSON(credentials, {
      transporterOptions: { signal: controller.signal, retry: false },
    });
    const authHeaders = await auth.getRequestHeaders();
    const headers = Object.fromEntries(authHeaders.entries());
    const url = new URL(
      `${client.baseUrl}/projects/${encodeURIComponent(projectId)}/datasets`,
    );
    url.searchParams.set("maxResults", String(PAGE_SIZE));
    const datasets: string[] = [];
    const seenTokens = new Set<string>();

    for (let page = 0; page < MAX_PAGES; page++) {
      // The SDK's teeny-request transport does not forward cancellation or size limits.
      const response = await fetch(url.toString(), {
        ...getDataSourceHttpOptions(),
        headers,
        signal: controller.signal as NonNullable<
          Parameters<typeof fetch>[1]
        >["signal"],
        size: MAX_RESPONSE_BYTES,
      });
      if (!response.ok) {
        throw new DatasetDiscoveryError(
          `BigQuery dataset discovery failed (HTTP ${response.status}).`,
        );
      }
      const body: unknown = await response.json();
      const result = datasetPageSchema.safeParse(body);
      if (!result.success) {
        throw new DatasetDiscoveryError(
          "BigQuery returned an invalid dataset list.",
        );
      }
      const pageDatasets = result.data.datasets ?? [];
      const remaining = MAX_DATASETS - datasets.length;
      datasets.push(
        ...pageDatasets
          .slice(0, remaining)
          .map((dataset) => dataset.datasetReference.datasetId),
      );
      const nextToken = result.data.nextPageToken;
      if (pageDatasets.length > remaining) return { datasets, truncated: true };
      if (!nextToken) return { datasets, truncated: false };
      if (datasets.length === MAX_DATASETS || seenTokens.has(nextToken)) {
        return { datasets, truncated: true };
      }
      seenTokens.add(nextToken);
      url.searchParams.set("pageToken", nextToken);
    }
    return { datasets, truncated: true };
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      throw new Error(
        "BigQuery dataset discovery timed out. Please try again.",
      );
    }
    if (error instanceof DatasetDiscoveryError) throw error;
    if (
      error instanceof Error &&
      "type" in error &&
      error.type === "max-size"
    ) {
      throw new Error(
        "BigQuery dataset discovery response exceeded the 5 MiB limit.",
      );
    }
    // Upstream errors can contain authentication material or untrusted response bodies.
    throw new Error(
      "Could not fetch BigQuery datasets. Check the project and service account credentials.",
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
