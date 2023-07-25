import { Response } from "express";
import uniqid from "uniqid";
import { AuthRequest } from "../types/AuthRequest";
import {
  findAllOrganizations,
  findOrganizationById,
  updateOrganization,
} from "../models/OrganizationModel";
import { PostgresConnectionParams } from "../../types/integrations/postgres";
import { createMetric } from "../services/experiments";
import { createDimension } from "../models/DimensionModel";
import {
  getOrganizationsWithDatasources,
  createDataSource,
} from "../models/DataSourceModel";
import { POSTGRES_TEST_CONN } from "../util/secrets";
import { createSegment } from "../models/SegmentModel";
import { EventAuditUserForResponseLocals } from "../events/event-types";

export async function getOrganizations(req: AuthRequest, res: Response) {
  if (!req.admin) {
    return res.status(403).json({
      status: 403,
      message: "Only admins can get all organizations",
    });
  }

  const organizations = await findAllOrganizations();

  const orgsWithDatasources = await getOrganizationsWithDatasources();

  return res.status(200).json({
    status: 200,
    organizations: organizations.map((o) => {
      return {
        ...o,
        canPopulate: !orgsWithDatasources.includes(o.id),
      };
    }),
  });
}

export async function addSampleData(
  req: AuthRequest<unknown, { id: string }>,
  res: Response<unknown, EventAuditUserForResponseLocals>
) {
  if (!req.admin) {
    return res.status(403).json({
      status: 403,
      message: "Only admins can perform this action",
    });
  }

  const { id } = req.params;

  const org = await findOrganizationById(id);
  if (!org) {
    throw new Error("Cannot find organization");
  }

  // Change organization settings (allow all kinds of experiments)
  org.settings = org.settings || {};
  org.settings.visualEditorEnabled = true;
  await updateOrganization(id, {
    settings: org.settings,
  });

  // Add datasource
  const dsParams: PostgresConnectionParams = {
    defaultSchema: "",
    ...POSTGRES_TEST_CONN,
  };
  const datasource = await createDataSource(
    org.id,
    "Example Warehouse",
    "postgres",
    dsParams,
    {
      userIdTypes: [
        {
          userIdType: "user_id",
          description: "Logged-in user id",
        },
      ],
      queries: {
        exposure: [
          {
            id: "user_id",
            userIdType: "user_id",
            query: `SELECT
            user_id,
            received_at as timestamp,
            experiment_id,
            variation_id
          FROM
            experiment_viewed`,
            name: "Logged-in Users",
            dimensions: [],
          },
        ],
      },
    }
  );

  // Define metrics
  await createMetric({
    organization: org.id,
    datasource: datasource.id,
    name: "Signup",
    type: "binomial",
    table: "signup",
    userIdTypes: ["user_id"],
    conditions: [],
  });
  await createMetric({
    organization: org.id,
    datasource: datasource.id,
    name: "Purchase",
    type: "binomial",
    table: "purchase",
    userIdTypes: ["user_id"],
    conditions: [],
  });
  await createMetric({
    organization: org.id,
    datasource: datasource.id,
    name: "Revenue per User",
    type: "revenue",
    table: "purchase",
    column: "amount",
    userIdTypes: ["user_id"],
    conditions: [],
  });
  await createMetric({
    organization: org.id,
    datasource: datasource.id,
    name: "Viewed Signup",
    type: "binomial",
    table: "viewed_signup",
    userIdTypes: ["user_id"],
    conditions: [],
  });
  await createMetric({
    organization: org.id,
    datasource: datasource.id,
    name: "Pages per Visit",
    type: "count",
    table: "pages",
    userIdTypes: ["user_id"],
    conditions: [],
    conversionDelayHours: -1,
  });
  await createMetric({
    organization: org.id,
    datasource: datasource.id,
    name: "Average Order Value",
    type: "revenue",
    table: "purchase",
    column: "amount",
    userIdTypes: ["user_id"],
    conditions: [],
    ignoreNulls: true,
  });
  await createMetric({
    organization: org.id,
    datasource: datasource.id,
    name: "Time on Site",
    type: "duration",
    table: "sessions",
    column: "duration_seconds",
    userIdTypes: ["user_id"],
    timestampColumn: "date_start",
    conditions: [],
    conversionDelayHours: -1,
  });

  // Example segment
  await createSegment({
    datasource: datasource.id,
    name: "Male",
    sql:
      "SELECT user_id, '2020-01-01 00:00:00'::timestamp as date from users where gender='male'",
    id: uniqid("seg_"),
    userIdType: "user_id",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: org.id,
  });

  // Example dimension
  await createDimension({
    datasource: datasource.id,
    name: "Gender",
    sql: "SELECT user_id, gender as value FROM users",
    id: uniqid("dim_"),
    userIdType: "user_id",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: org.id,
  });

  res.json({
    status: 200,
  });
}
