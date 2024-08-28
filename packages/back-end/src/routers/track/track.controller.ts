import type { Request, Response } from "express";
import { findSDKConnectionByKey } from "@back-end/src/models/SdkConnectionModel";
import { getContextForAgendaJobByOrgId } from "@back-end/src/services/organizations";
import { getSourceIntegrationObject } from "@back-end/src/services/datasource";
import { getDataSourceById } from "@back-end/src/models/DataSourceModel";

export const postEvent = async (
  req: Request<
    {
      clientKey: string;
    },
    { status: 200 },
    {
      event_name: string;
      value?: number;
      properties?: Record<string, unknown>;
      attributes?: Record<string, unknown>;
    }
  >,
  res: Response<{ status: 200 }>
) => {
  // Lookup org from clientKey
  const { clientKey } = req.params;

  if (!clientKey.match(/^sdk-/)) {
    throw new Error("Invalid Client Key.  Must start with 'sdk-'");
  }

  const connection = await findSDKConnectionByKey(clientKey);
  if (!connection) {
    throw new Error("Invalid Client Key");
  }

  if (!connection.trackingDatasource) {
    throw new Error(
      "SDK Connection does not have a tracking datasource enabled"
    );
  }

  const context = await getContextForAgendaJobByOrgId(connection.organization);

  const ds = await getDataSourceById(context, connection.trackingDatasource);
  if (!ds) {
    throw new Error("Tracking Datasource not found");
  }

  const integration = getSourceIntegrationObject(context, ds);
  if (!integration.insertTrackEvent) {
    throw new Error("Tracking Datasource does not support track events");
  }

  await integration.insertTrackEvent({
    event_name: req.body.event_name,
    attributes: req.body.attributes,
    properties: req.body.properties,
    value: req.body.value,
  });

  res.status(200).json({
    status: 200,
  });
};

export const postFeatureUsage = async (
  req: Request<
    {
      clientKey: string;
    },
    { status: 200 },
    {
      feature: string;
      revision: string;
      ruleId?: string;
      variationId?: string;
    }
  >,
  res: Response<{ status: 200 }>
) => {
  // Lookup org from clientKey
  const { clientKey } = req.params;

  if (!clientKey.match(/^sdk-/)) {
    throw new Error("Invalid Client Key.  Must start with 'sdk-'");
  }

  const connection = await findSDKConnectionByKey(clientKey);
  if (!connection) {
    throw new Error("Invalid Client Key");
  }

  if (!connection.trackingDatasource) {
    throw new Error(
      "SDK Connection does not have a tracking datasource enabled"
    );
  }

  const context = await getContextForAgendaJobByOrgId(connection.organization);

  const ds = await getDataSourceById(context, connection.trackingDatasource);
  if (!ds) {
    throw new Error("Tracking Datasource not found");
  }

  const integration = getSourceIntegrationObject(context, ds);
  if (!integration.insertFeatureUsage) {
    throw new Error("Tracking Datasource does not support feature usage");
  }

  await integration.insertFeatureUsage({
    feature: req.body.feature,
    revision: req.body.revision,
    ruleId: req.body.ruleId || "",
    variationId: req.body.variationId || "",
    env: connection.environment,
  });

  res.status(200).json({
    status: 200,
  });
};
