import type { Request, Response } from "express";
import { InsertTrackEventProps } from "@back-end/src/types/Integration";
import { getContextForAgendaJobByOrgId } from "../../services/organizations";
import { getSourceIntegrationObject } from "../../services/datasource";
import { getDataSourceById } from "../../models/DataSourceModel";
import { findSDKConnectionByKey } from "../../models/SdkConnectionModel";

export const postEvent = async (
  req: Request<
    {
      clientKey: string;
    },
    { status: 200 },
    unknown,
    {
      event_name: string;
      value?: string;
      properties?: string;
      attributes?: string;
    }
  >,
  res: Response<{ status: 200 }>
) => {
  // Validate arguments
  const query = req.query;

  const data: InsertTrackEventProps = {
    event_name: query.event_name,
  };

  try {
    if (query.value) {
      data.value = parseFloat(query.value);
    }
    if (query.properties) {
      data.properties = JSON.parse(query.properties);
    }
    if (query.attributes) {
      data.attributes = JSON.parse(query.attributes);
    }
  } catch (e) {
    throw new Error("Invalid arguments");
  }

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

  await integration.insertTrackEvent(data);

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
    unknown,
    {
      feature: string;
      revision: string;
      value: string;
      source: string;
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
    feature: req.query.feature,
    revision: req.query.revision,
    ruleId: req.query.ruleId || "",
    variationId: req.query.variationId || "",
    env: connection.environment,
    source: req.query.source || "",
    value: req.query.value || "",
  });

  res.status(200).json({
    status: 200,
  });
};
