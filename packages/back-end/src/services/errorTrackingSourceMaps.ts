import { getGrowthbookDatasource } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { ReqContextClass } from "back-end/src/services/context";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import { generateId } from "back-end/src/util/uuid";
import { ErrorSourceMapModel } from "back-end/src/models/ErrorSourceMapModel";

export async function requireErrorTrackingClickhouse(context: ReqContextClass) {
  const ds = await getGrowthbookDatasource(context);
  if (!ds) {
    throw new Error(
      "Managed warehouse is not configured for this organization.",
    );
  }

  const integration = getSourceIntegrationObject(context, ds, true);
  if (!(integration instanceof SqlIntegration)) {
    throw new Error("Managed warehouse datasource is not ClickHouse.");
  }

  return { datasource: ds, integration };
}

export async function upsertErrorSourceMap({
  organizationId,
  clientKey,
  release,
  minifiedUrl,
  sourceMapJson,
}: {
  organizationId: string;
  clientKey: string;
  release: string;
  minifiedUrl: string;
  sourceMapJson: string;
}) {
  const now = new Date();

  await ErrorSourceMapModel.findOneAndUpdate(
    {
      organization: organizationId,
      clientKey,
      release,
      minifiedUrl,
    },
    {
      $set: {
        sourceMapJson,
        dateUpdated: now,
      },
      $setOnInsert: {
        id: generateId("esm_"),
        organization: organizationId,
        clientKey,
        release,
        minifiedUrl,
        dateCreated: now,
      },
    },
    { upsert: true },
  );
}

export async function listErrorSourceMaps({
  organizationId,
  clientKey,
  release,
}: {
  organizationId: string;
  clientKey: string;
  release?: string;
}) {
  const query: Record<string, string> = {
    organization: organizationId,
    clientKey,
  };
  if (release) {
    query.release = release;
  }

  return ErrorSourceMapModel.find(query, {
    minifiedUrl: 1,
    release: 1,
    dateUpdated: 1,
  })
    .sort({ dateUpdated: -1 })
    .limit(200)
    .lean();
}
