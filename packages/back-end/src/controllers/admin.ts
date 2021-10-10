import { AuthRequest } from "../types/AuthRequest";
import {
  findAllOrganizations,
  findOrganizationById,
  updateOrganization,
} from "../models/OrganizationModel";
import { Response } from "express";
import { PostgresConnectionParams } from "../../types/integrations/postgres";
import {
  createExperiment,
  createMetric,
  createSnapshot,
} from "../services/experiments";
import { SegmentModel } from "../models/SegmentModel";
import uniqid from "uniqid";
import { createDimension } from "../models/DimensionModel";
import { getSourceIntegrationObject } from "../services/datasource";
import { ExperimentInterface } from "../../types/experiment";
import { createIdea } from "../services/ideas";
import { createImpactEstimate } from "../models/ImpactEstimateModel";
import { createPresentation } from "../services/presentations";
import {
  getOrganizationsWithDatasources,
  createDataSource,
} from "../models/DataSourceModel";
import { POSTGRES_TEST_CONN } from "../util/secrets";
import { PresentationSlide } from "../../types/presentation";
import { processPastExperimentQueryResponse } from "../services/queries";

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

export async function addSampleData(req: AuthRequest, res: Response) {
  if (!req.admin) {
    return res.status(403).json({
      status: 403,
      message: "Only admins can perform this action",
    });
  }

  const { id }: { id: string } = req.params;

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
      queries: {
        experimentsQuery: `SELECT
    user_id,
    user_id as anonymous_id,
    received_at as timestamp,
    experiment_id,
    variation_id
  FROM
    experiment_viewed`,
        pageviewsQuery: `SELECT
    user_id,
    user_id as anonymous_id,
    received_at as timestamp,
    '' as url
  FROM
    pages`,
      },
      variationIdFormat: "index",
    }
  );
  const integration = getSourceIntegrationObject(datasource);

  // Define metrics
  const signup = await createMetric({
    organization: org.id,
    datasource: datasource.id,
    name: "Signup",
    type: "binomial",
    table: "signup",
    userIdType: "user",
    conditions: [],
  });
  const purchase = await createMetric({
    organization: org.id,
    datasource: datasource.id,
    name: "Purchase",
    type: "binomial",
    table: "purchase",
    userIdType: "user",
    conditions: [],
  });
  const revenuPerUser = await createMetric({
    organization: org.id,
    datasource: datasource.id,
    name: "Revenue per User",
    type: "revenue",
    table: "purchase",
    column: "amount",
    userIdType: "user",
    conditions: [],
  });
  const viewedSignup = await createMetric({
    organization: org.id,
    datasource: datasource.id,
    name: "Viewed Signup",
    type: "binomial",
    table: "viewed_signup",
    userIdType: "either",
    conditions: [],
  });
  const pagesPerVisit = await createMetric({
    organization: org.id,
    datasource: datasource.id,
    name: "Pages per Visit",
    type: "count",
    table: "pages",
    userIdType: "either",
    conditions: [],
    earlyStart: true,
  });
  const aov = await createMetric({
    organization: org.id,
    datasource: datasource.id,
    name: "Average Order Value",
    type: "revenue",
    table: "purchase",
    column: "amount",
    userIdType: "user",
    conditions: [],
    ignoreNulls: true,
  });
  const timeOnSite = await createMetric({
    organization: org.id,
    datasource: datasource.id,
    name: "Time on Site",
    type: "duration",
    table: "sessions",
    column: "duration_seconds",
    userIdType: "either",
    timestampColumn: "date_start",
    conditions: [],
    earlyStart: true,
  });

  // Example segment
  await SegmentModel.create({
    datasource: datasource.id,
    name: "Male",
    sql:
      "SELECT user_id, '2020-01-01 00:00:00'::timestamp as date from users where gender='male'",
    id: uniqid("seg_"),
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
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: org.id,
  });

  // Import experiments
  const yearago = new Date();
  yearago.setDate(yearago.getDate() - 365);
  const pastExperimentsResponse = await integration.runPastExperimentQuery(
    integration.getPastExperimentQuery({ from: yearago })
  );
  const pastExperimentsResult = processPastExperimentQueryResponse(
    pastExperimentsResponse
  );
  const sharedFields: Partial<ExperimentInterface> = {
    description: "",
    implementation: "code",
    hypothesis: "",
    tags: [],
    datasource: datasource.id,
    userIdType: "user",
    targetURLRegex: ".*",
    status: "stopped",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: org.id,
    results: "inconclusive",
  };
  const experiments: { [key: string]: Partial<ExperimentInterface> } = {};
  pastExperimentsResult.experiments.forEach((imp) => {
    if (!experiments[imp.experiment_id]) {
      experiments[imp.experiment_id] = {
        ...sharedFields,
        trackingKey: imp.experiment_id,
        phases: [
          {
            coverage: 1,
            phase: "main",
            // TODO: support uneven variation weights
            variationWeights: [0.5, 0.5],
            reason: "",
            dateStarted: imp.start_date,
            dateEnded: imp.end_date,
          },
        ],
      };
    }
    const data = experiments[imp.experiment_id];

    if (data.phases && data.phases[0]) {
      if (data.phases[0].dateStarted > imp.start_date) {
        data.phases[0].dateStarted = imp.start_date;
      }
      if (data.phases[0].dateEnded && data.phases[0].dateEnded < imp.end_date) {
        data.phases[0].dateEnded = imp.end_date;
      }
    }

    if (imp.experiment_id === "green_buttons") {
      data.name = "Google Login";
      data.description =
        "There's been a lot of research to show that users don't like signing up for lots of different accounts.\n\nWe should try adding the option to login with social providers. Google is most popular with our users, so we want to start with that as a test. It's possible the design we're using for this won't scale to other social providers, but this is more about testing the concept, not the specific design.";
      data.hypothesis =
        "Allowing people to login with Google will increase our signup rate";
      data.activationMetric = viewedSignup.id;
      data.userIdType = "anonymous";
      data.variations = [
        {
          name: "Control",
          screenshots: [
            {
              path:
                "https://cdn.growthbook.io/org_a919vk7kc59purn/exp_21e16hskhpd19kf/img_1p41rrkhupwkl9.png",
            },
          ],
        },
        {
          name: "Google Login",
          screenshots: [
            {
              path:
                "https://cdn.growthbook.io/org_a919vk7kc59purn/exp_21e16hskhpd19kf/img_1p41rrkhupwosz.png",
            },
          ],
        },
      ];
      data.results = "won";
      data.winner = 1;
      data.analysis =
        "Metrics up a little bit, but not completely significant. Calling it a winner since it fits our overall product direction.";
      data.metrics = [signup.id, timeOnSite.id, pagesPerVisit.id];
    } else if (imp.experiment_id === "purchase_cta") {
      data.name = "Purchase CTA";
      data.description =
        "Stripe Checkout puts the dollar amount on their buy button. We know they do a ton of testing, so we should try that as well. Here is their page:\n\n![Stripe Checkout](https://i.stack.imgur.com/lMhQr.png)";
      data.hypothesis =
        "Adding a dollar amount to the buy button will remove uncertainty from users and cause them to convert at a higher rate.";
      data.variations = [
        {
          name: "Control",
          screenshots: [
            {
              path:
                "https://cdn.growthbook.io/org_a919vk7kc59purn/exp_21e16hskhpckzk1/img_1p41rrkhupx408.png",
            },
          ],
        },
        {
          name: "Price in CTA",
          screenshots: [
            {
              path:
                "https://cdn.growthbook.io/org_a919vk7kc59purn/exp_21e16hskhpckzk1/img_1p41rrkhupx92w.png",
            },
          ],
        },
      ];
      data.metrics = [purchase.id, revenuPerUser.id, aov.id];
      data.results = "inconclusive";
    } else if (imp.experiment_id === "simple_registration") {
      data.name = "Simple Registration";
      data.description =
        "Our signup form is way longer than our competitors. First and Last name are important to keep our email open and click rates right, but at what cost?\n\n      This experiment will tell us how many signups this longer form is costing us. If it's significant, maybe we can figure out a hybrid approach where First and Last name are not required up front, but we prompt for it later.";
      data.hypothesis =
        "Removing everything except email and password will reduce friction and increase signups.";
      data.variations = [
        {
          name: "Control",
          screenshots: [
            {
              path:
                "https://cdn.growthbook.io/org_a919vk7kc59purn/exp_21e16hskhpcphqw/img_1p41rrkhupxr9f.png",
            },
          ],
        },
        {
          name: "Shorter Reg Modal",
          screenshots: [
            {
              path:
                "https://cdn.growthbook.io/org_a919vk7kc59purn/exp_21e16hskhpcphqw/img_1p41rrkhupxuup.png",
            },
          ],
        },
      ];
      data.userIdType = "anonymous";
      data.activationMetric = viewedSignup.id;
      data.metrics = [signup.id];
      data.results = "dnf";
      data.analysis = "Found a bug with the experiment.";
    }
  });
  const evidence: string[] = [];
  await Promise.all(
    Object.keys(experiments).map(async (key) => {
      const data = experiments[key];
      if (!data.name) return;

      // Create experiment document
      const exp = await createExperiment(data);

      // Add a few experiments to evidence
      if (
        ["simple_registration", "green_buttons"].includes(
          data.trackingKey || ""
        )
      ) {
        evidence.push(exp.id);
      }

      // Refresh results
      await createSnapshot(exp, 0, datasource);
    })
  );

  // Example idea
  const estimate = await createImpactEstimate(
    org.id,
    signup.id,
    "",
    ".*",
    153.429,
    1901.71,
    153.429,
    "-- Traffic to selected pages\nSELECT\n  COUNT(DISTINCT user_id) as users\nFROM\n  pages\nWHERE\n  received_at >= '2020-11-13 16:26:12'\n  AND received_at <= '2020-11-20 16:26:12'\n  AND path ~ '.*';\n\n-- Entire site: Signup (binomial)\nWITH metric as (\n  SELECT\n    1 as value\n  FROM\n    pages u\n    JOIN signup m ON (\n      m.user_id = u.user_id\n      AND m.received_at >= u.received_at\n      AND m.received_at <= u.received_at + INTERVAL '3 days'\n    )\n  WHERE\n    u.received_at >= '2020-11-13 16:26:12'\n    AND u.received_at <= '2020-11-20 16:26:12'\n  GROUP BY\n    u.user_id\n)\nSELECT\n  SUM(value) as total\nFROM\n  metric;\n\n-- Selected pages only: Signup (binomial)\nWITH metric as (\n  SELECT\n    1 as value\n  FROM\n    pages u\n    JOIN signup m ON (\n      m.user_id = u.user_id\n      AND m.received_at >= u.received_at\n      AND m.received_at <= u.received_at + INTERVAL '3 days'\n    )\n  WHERE\n    u.received_at >= '2020-11-13 16:26:12'\n    AND u.received_at <= '2020-11-20 16:26:12'\n    AND u.path ~ '.*'\n  GROUP BY\n    u.user_id\n)\nSELECT\n  SUM(value) as value\nFROM\n  metric;",
    "sql"
  );
  await createIdea({
    text: "Add Facebook Login",
    details: "We saw a huge lift when we added Login with Google",
    estimateParams: {
      estimate: estimate.id,
      improvement: 10,
      numVariations: 2,
      userAdjustment: 100,
    },
    experimentLength: 18,
    impactScore: 38,
    votes: [],
    tags: [],
    organization: org.id,
    userId: "growthbook",
    userName: "Example User",
  });

  // Example presentation
  const exp: PresentationSlide = {
    id: evidence[0],
    type: "experiment",
  };
  await createPresentation({
    title: "Example A/B Test Review",
    slides: [exp],
    organization: org.id,
    description: "",
  });

  res.json({
    status: 200,
  });
}
