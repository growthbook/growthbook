import { z } from "zod";
import {
  postMetricApiPayloadIsValid,
  postMetricApiPayloadToMetricInterface,
} from "../../src/services/experiments";
import { postMetricValidator } from "../../src/validators/openapi";
import { DataSourceInterface } from "../../types/datasource";
import { OrganizationInterface } from "../../types/organization";

describe("experiments utils", () => {
  describe("postMetricApiPayloadIsValid", () => {
    it("should return a successful result when providing the minimum number of fields", () => {
      const input: z.infer<typeof postMetricValidator.bodySchema> = {
        datasourceId: "ds_abc123",
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
        },
        name: "My Cool Metric",
        type: "count",
      };
      const datasource: Pick<DataSourceInterface, "type"> = {
        type: 'mysql'
      }

      const result = postMetricApiPayloadIsValid(input, datasource) as {
        valid: true;
      };

      expect(result.valid).toBe(true);
    });

    it("should return a failed result when multiple query formats provided", () => {
      const input: z.infer<typeof postMetricValidator.bodySchema> = {
        datasourceId: "ds_abc123",
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
        },
        mixpanel: {
          eventName: "foo",
          eventValue: "foo",
          userAggregation: "select * from foo",
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = postMetricApiPayloadIsValid(input) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Can only specify one of: sql, sqlBuilder, mixpanel"
      );
    });

    it("should return a failed result if binomial type specified and has userAggregationSQL", () => {
      const input: z.infer<typeof postMetricValidator.bodySchema> = {
        datasourceId: "ds_abc123",
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        name: "My Cool Metric",
        type: "binomial",
      };

      const result = postMetricApiPayloadIsValid(input) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Binomial metrics cannot have userAggregationSQL"
      );
    });

    it("should return a failed result when conversionWindowEnd provided but not conversionWindowStart", () => {
      const input: z.infer<typeof postMetricValidator.bodySchema> = {
        datasourceId: "ds_abc123",
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          conversionWindowEnd: 1337,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = postMetricApiPayloadIsValid(input) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Must specify `behavior.conversionWindowStart` when providing `behavior.conversionWindowEnd`"
      );
    });
  });

  describe("postMetricApiPayloadToMetricInterface", () => {
    describe("SQL datasource", () => {
      const datasource: Pick<DataSourceInterface, "type"> = {
        type: "postgres",
      };
      const organization: OrganizationInterface = {
        id: "org_abc123",
        url: "",
        dateCreated: new Date(),
        name: "Acme Donuts",
        ownerEmail: "acme@acme-donuts.net",
        members: [],
        invites: [],
      };

      it("should create a MetricInterface from a postMetric payload", () => {
        const input: z.infer<typeof postMetricValidator.bodySchema> = {
          datasourceId: "ds_abc123",
          sql: {
            identifierTypes: ["user_id"],
            conversionSQL: "select * from foo",
            userAggregationSQL: "sum(values)",
          },
          name: "My Cool Metric",
          type: "binomial",
        };

        const result = postMetricApiPayloadToMetricInterface(
          input,
          organization,
          datasource
        );

        expect(result.aggregation).toEqual("sum(values)");
        expect(result.conditions).toEqual([]);
        expect(result.datasource).toEqual("ds_abc123");
        expect(result.denominator).toBe(undefined);
        expect(result.description).toEqual("");
        expect(result.ignoreNulls).toEqual(false);
        expect(result.inverse).toEqual(false);
        expect(result.name).toEqual("My Cool Metric");
        expect(result.organization).toEqual("org_abc123");
        expect(result.owner).toEqual("");
        expect(result.projects).toEqual([]);
        expect(result.tags).toEqual([]);
        expect(result.queries).toEqual([]);
        expect(result.queryFormat).toEqual("sql");
        expect(result.runStarted).toEqual(null);
        expect(result.sql).toEqual("select * from foo");
        expect(result.type).toEqual("binomial");
        expect(result.userIdTypes).toEqual(["user_id"]);
      });
    });

    describe("mixpanel datasource", () => {
      const datasource: Pick<DataSourceInterface, "type"> = {
        type: "mixpanel",
      };
      const organization: OrganizationInterface = {
        id: "org_abc123",
        url: "",
        dateCreated: new Date(),
        name: "Acme Donuts",
        ownerEmail: "acme@acme-donuts.net",
        members: [],
        invites: [],
      };

      it("should create a MetricInterface from a postMetric payload", () => {
        const input: z.infer<typeof postMetricValidator.bodySchema> = {
          datasourceId: "ds_abc123",
          mixpanel: {
            eventName: "viewed_signup",
            eventValue: "did_view",
            userAggregation: "sum(values)",
            conditions: [],
          },
          name: "My Cool Metric",
          type: "count",
        };

        const result = postMetricApiPayloadToMetricInterface(
          input,
          organization,
          datasource
        );

        expect(result.aggregation).toEqual("sum(values)");
        expect(result.conditions).toEqual([]);
        expect(result.datasource).toEqual("ds_abc123");
        expect(result.denominator).toBe(undefined);
        expect(result.description).toEqual("");
        expect(result.ignoreNulls).toEqual(false);
        expect(result.inverse).toEqual(false);
        expect(result.name).toEqual("My Cool Metric");
        expect(result.organization).toEqual("org_abc123");
        expect(result.owner).toEqual("");
        expect(result.projects).toEqual([]);
        expect(result.tags).toEqual([]);
        expect(result.queries).toEqual([]);
        expect(result.queryFormat).toEqual(undefined);
        expect(result.runStarted).toEqual(null);
        expect(result.sql).toEqual(undefined);
        expect(result.type).toEqual("count");
        expect(result.userIdTypes).toEqual(undefined);
      });
    });
  });
});
