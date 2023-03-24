import { ApiMetric } from "../../types/openapi";
import { partialFromMetricApiInterface } from "../../src/services/experiments";
import { OrganizationInterface } from "../../types/organization";
import { DataSourceInterface } from "../../types/datasource";

describe("experiment services", () => {
  describe("fromMetricApiInterface", () => {
    it("should convert an ApiMetric to a MetricInterface", () => {
      const input: Partial<ApiMetric> = {};
      const org: OrganizationInterface = {
        autoApproveMembers: false,
        connections: undefined,
        dateCreated: undefined,
        disableSelfServeBilling: false,
        enterprise: false,
        freeSeats: 0,
        licenseKey: "",
        priceId: "",
        restrictAuthSubPrefix: "",
        restrictLoginMethod: "",
        stripeCustomerId: "",
        subscription: {
          cancel_at: undefined,
          cancel_at_period_end: false,
          canceled_at: undefined,
          current_period_end: 0,
          id: "",
          planNickname: undefined,
          qty: 0,
          status: undefined,
          trialEnd: undefined,
        },
        verifiedDomain: "",
        invites: [],
        ownerEmail: "tina@growthbook.io",
        name: "GrowthBook",
        id: "org_sktwi1id9l7z9xkjb",
        url: "",
        discountCode: "",
        settings: {
          environments: [
            {
              id: "production",
              description: "",
              toggleOnList: true,
              defaultState: true,
            },
            {
              id: "staging",
              description: "",
              toggleOnList: true,
              defaultState: true,
            },
          ],
          attributeSchema: [
            {
              property: "id",
              datatype: "string",
              hashAttribute: true,
            },
          ],
          sdkInstructionsViewed: true,
          pastExperimentsMinLength: 6,
          visualEditorEnabled: false,
          metricAnalysisDays: 180,
          customized: false,
          logoPath: "",
          primaryColor: "#ff3399",
          secondaryColor: "#50279a",
          northStar: {
            title: "",
            metricIds: [],
          },
          updateSchedule: {
            type: "cron",
            hours: 8,
            cron: "0 */8 * * *",
          },
          multipleExposureMinPercent: 0.01,
          namespaces: [
            {
              name: "something",
              description: "namespace description",
              status: "active",
            },
          ],
          defaultRole: {
            role: "collaborator",
            environments: [],
            limitAccessByEnvironment: false,
          },
          statsEngine: "bayesian",
          metricDefaults: {
            minimumSampleSize: 161,
            maxPercentageChange: 0.6,
            minPercentageChange: 0.006,
          },
        },
        members: [],
        pendingMembers: [],
      };
      const dataSource: DataSourceInterface = {
        description: "My amazing Postgres datasource",
        organization: "org_sktwi1id9l7z9xkjb",
        id: "ds_9c3f6ccc1dc747ab9d",
        name: "My Postgres",
        type: "postgres",
        settings: {
          queries: {
            experimentsQuery:
              "SELECT\n  user_id as user_id,\n  user_id as anonymous_id,\n  received_at as timestamp,\n  experiment_id as experiment_id,\n  variation_id as variation_id,\n  (CASE WHEN user_agent SIMILAR TO '%(mobile|android)%' THEN 'mobile' ELSE 'desktop' END) as device,\n   user_agent as device_browser\nFROM \n  experiment_viewed",
            pageviewsQuery:
              "SELECT\n  user_id as user_id,\n  user_id as anonymous_id,\n  received_at as timestamp,\n  path as url\nFROM \n  pages",
            exposure: [
              {
                id: "user_id",
                name: "Logged-in User Experiments",
                description: "",
                userIdType: "user_id",
                dimensions: ["device_browser"],
                query:
                  "SELECT\n  user_id as user_id,\n  received_at as timestamp,\n  experiment_id as experiment_id,\n  variation_id as variation_id,\n  user_agent as device_browser\nFROM \n  experiment_viewed",
              },
              {
                id: "anonymous_id",
                name: "Anonymous Visitor Experiments",
                description: "",
                userIdType: "anonymous_id",
                dimensions: ["device_browser"],
                query:
                  "SELECT\n  user_id as anonymous_id,\n  received_at as timestamp,\n  experiment_id as experiment_id,\n  variation_id as variation_id,\n  user_agent as device_browser\nFROM \n  experiment_viewed",
              },
            ],
            identityJoins: [],
          },
          userIdTypes: [
            {
              userIdType: "user_id",
              description: "Logged-in user id",
            },
            {
              userIdType: "anonymous_id",
              description: "Anonymous visitor id",
            },
          ],
        },
        params: "",
        projects: [],
        dateCreated: new Date("2022-10-12T17:46:53.250Z"),
        dateUpdated: new Date("2022-10-12T17:46:53.250Z"),
      };

      const result = partialFromMetricApiInterface(org, input, dataSource);

      console.log("result", result);
    });
  });
});
