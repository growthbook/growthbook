import { z } from "zod";
import { postMetricValidator, putMetricValidator } from "shared/validators";
import { DataSourceInterface } from "shared/types/datasource";
import { ExperimentSnapshotRefreshIntent } from "shared/types/experiment-snapshot";
import { OrganizationInterface } from "shared/types/organization";
import {
  postMetricApiPayloadIsValid,
  postMetricApiPayloadToMetricInterface,
  putMetricApiPayloadIsValid,
  putMetricApiPayloadToMetricInterface,
  mergeSnapshotRefreshIntent,
  buildSnapshotRefreshIntent,
  getFollowupStandardSnapshotExecution,
} from "back-end/src/services/experiments";

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
        type: "mysql",
      };

      const result = postMetricApiPayloadIsValid(input, datasource) as {
        valid: true;
      };

      expect(result.valid).toBe(true);
    });

    it("should return a failed result when multiple query formats provided", () => {
      const datasource: Pick<DataSourceInterface, "type"> = {
        type: "mixpanel",
      };
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

      const result = postMetricApiPayloadIsValid(input, datasource) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Can only specify one of: sql, sqlBuilder, mixpanel",
      );
    });

    it("should return a failed result if binomial type specified and has userAggregationSQL", () => {
      const datasource: Pick<DataSourceInterface, "type"> = {
        type: "postgres",
      };
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

      const result = postMetricApiPayloadIsValid(input, datasource) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Binomial metrics cannot have userAggregationSQL",
      );
    });

    it("should return a failed result when conversionWindowEnd provided but not conversionWindowStart", () => {
      const datasource: Pick<DataSourceInterface, "type"> = {
        type: "postgres",
      };
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

      const result = postMetricApiPayloadIsValid(input, datasource) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither",
      );
    });

    it("should return a failed result when conversionWindowEnd less than conversionWindowStart", () => {
      const datasource: Pick<DataSourceInterface, "type"> = {
        type: "postgres",
      };
      const input: z.infer<typeof postMetricValidator.bodySchema> = {
        datasourceId: "ds_abc123",
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          conversionWindowStart: 10,
          conversionWindowEnd: 5,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = postMetricApiPayloadIsValid(input, datasource) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "`behavior.conversionWindowEnd` must be greater than `behavior.conversionWindowStart`",
      );
    });

    it("should return a failed result when conversionWindowStart provided but not conversionWindowEnd", () => {
      const datasource: Pick<DataSourceInterface, "type"> = {
        type: "postgres",
      };
      const input: z.infer<typeof postMetricValidator.bodySchema> = {
        datasourceId: "ds_abc123",
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          conversionWindowStart: 0,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = postMetricApiPayloadIsValid(input, datasource) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither",
      );
    });

    it("should return a failed result when minPercentageChange provided but not maxPercentageChange", () => {
      const datasource: Pick<DataSourceInterface, "type"> = {
        type: "postgres",
      };
      const input: z.infer<typeof postMetricValidator.bodySchema> = {
        datasourceId: "ds_abc123",
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          minPercentChange: 0.05,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = postMetricApiPayloadIsValid(input, datasource) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Must specify both `behavior.maxPercentChange` and `behavior.minPercentChange` or neither",
      );
    });

    it("should return a failed result when maxPercentageChange provided but not minPercentageChange", () => {
      const datasource: Pick<DataSourceInterface, "type"> = {
        type: "postgres",
      };
      const input: z.infer<typeof postMetricValidator.bodySchema> = {
        datasourceId: "ds_abc123",
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          maxPercentChange: 0.5,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = postMetricApiPayloadIsValid(input, datasource) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Must specify both `behavior.maxPercentChange` and `behavior.minPercentChange` or neither",
      );
    });

    it("should return a failed result when maxPercentageChange is not greater than minPercentageChange", () => {
      const datasource: Pick<DataSourceInterface, "type"> = {
        type: "postgres",
      };
      const input: z.infer<typeof postMetricValidator.bodySchema> = {
        datasourceId: "ds_abc123",
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          minPercentChange: 0.5,
          maxPercentChange: 0.005,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = postMetricApiPayloadIsValid(input, datasource) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "`behavior.maxPercentChange` must be greater than `behavior.minPercentChange`",
      );
    });

    it("should return a failed result if both risk threshold values are not provided", () => {
      const datasource: Pick<DataSourceInterface, "type"> = {
        type: "postgres",
      };
      const input: z.infer<typeof postMetricValidator.bodySchema> = {
        datasourceId: "ds_abc123",
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          riskThresholdSuccess: 0.5,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = postMetricApiPayloadIsValid(input, datasource) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Must provide both riskThresholdDanger and riskThresholdSuccess or neither.",
      );
    });

    it("should return a failed result if the risk threshold danger value is less than the success value", () => {
      const datasource: Pick<DataSourceInterface, "type"> = {
        type: "postgres",
      };
      const input: z.infer<typeof postMetricValidator.bodySchema> = {
        datasourceId: "ds_abc123",
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          riskThresholdSuccess: 0.5,
          riskThresholdDanger: 0.1,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = postMetricApiPayloadIsValid(input, datasource) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "riskThresholdDanger must be higher than riskThresholdSuccess",
      );
    });

    it("should return a successful result if both risk threshold values are provided", () => {
      const datasource: Pick<DataSourceInterface, "type"> = {
        type: "postgres",
      };
      const input: z.infer<typeof postMetricValidator.bodySchema> = {
        datasourceId: "ds_abc123",
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          riskThresholdSuccess: 0.5,
          riskThresholdDanger: 0.99,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = postMetricApiPayloadIsValid(input, datasource) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(true);
    });

    it("should return a failure result if datasource configuration is omitted", () => {
      const datasource: Pick<DataSourceInterface, "type"> = {
        type: "postgres",
      };
      const input: z.infer<typeof postMetricValidator.bodySchema> = {
        datasourceId: "ds_abc123",
        behavior: {
          riskThresholdSuccess: 0.5,
          riskThresholdDanger: 0.99,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = postMetricApiPayloadIsValid(input, datasource) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toBe(
        "Can only specify one of: sql, sqlBuilder, mixpanel",
      );
    });
  });

  describe("putMetricApiPayloadIsValid", () => {
    it("should return a successful result when providing the minimum number of fields", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
        },
        name: "My Cool Metric",
        type: "count",
      };
      const result = putMetricApiPayloadIsValid(input) as {
        valid: true;
      };

      expect(result.valid).toBe(true);
    });

    it("should return a failed result when multiple query formats provided", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
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

      const result = putMetricApiPayloadIsValid(input) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Can only specify one of: sql, sqlBuilder, mixpanel",
      );
    });

    it("should return a failed result if binomial type specified and has userAggregationSQL", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        name: "My Cool Metric",
        type: "binomial",
      };

      const result = putMetricApiPayloadIsValid(input) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Binomial metrics cannot have userAggregationSQL",
      );
    });

    it("should return a failed result when conversionWindowEnd provided but not conversionWindowStart", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
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

      const result = putMetricApiPayloadIsValid(input) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither",
      );
    });

    it("should return a failed result when conversionWindowEnd less than conversionWindowStart", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          conversionWindowStart: 10,
          conversionWindowEnd: 5,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = putMetricApiPayloadIsValid(input) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "`behavior.conversionWindowEnd` must be greater than `behavior.conversionWindowStart`",
      );
    });

    it("should return a failed result when conversionWindowStart provided but not conversionWindowEnd", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          conversionWindowStart: 0,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = putMetricApiPayloadIsValid(input) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither",
      );
    });

    it("should return a failed result when minPercentageChange provided but not maxPercentageChange", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          minPercentChange: 0.05,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = putMetricApiPayloadIsValid(input) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Must specify both `behavior.maxPercentChange` and `behavior.minPercentChange` or neither",
      );
    });

    it("should return a failed result when maxPercentageChange provided but not minPercentageChange", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          maxPercentChange: 0.5,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = putMetricApiPayloadIsValid(input) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Must specify both `behavior.maxPercentChange` and `behavior.minPercentChange` or neither",
      );
    });

    it("should return a failed result when maxPercentageChange is not greater than minPercentageChange", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          minPercentChange: 0.5,
          maxPercentChange: 0.005,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = putMetricApiPayloadIsValid(input) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "`behavior.maxPercentChange` must be greater than `behavior.minPercentChange`",
      );
    });

    it("should return a failed result if both risk threshold values are not provided", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          riskThresholdSuccess: 0.5,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = putMetricApiPayloadIsValid(input) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "Must provide both riskThresholdDanger and riskThresholdSuccess or neither.",
      );
    });

    it("should return a failed result if the risk threshold danger value is less than the success value", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          riskThresholdSuccess: 0.5,
          riskThresholdDanger: 0.1,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = putMetricApiPayloadIsValid(input) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(false);
      expect(result.error).toEqual(
        "riskThresholdDanger must be higher than riskThresholdSuccess",
      );
    });

    it("should return a successful result if both risk threshold values are provided", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        behavior: {
          riskThresholdSuccess: 0.5,
          riskThresholdDanger: 0.99,
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = putMetricApiPayloadIsValid(input) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(true);
    });

    it("should return a successful result if no datasource is provided", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
        name: "My Updated Metric",
        type: "count",
      };

      const result = putMetricApiPayloadIsValid(input) as {
        valid: false;
        error: string;
      };

      expect(result.valid).toBe(true);
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

      it("with minimum payload, should create a MetricInterface from a postMetric payload", () => {
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
          datasource,
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

      it("with a full payload, should create a MetricInterface from a postMetric payload", () => {
        const input: z.infer<typeof postMetricValidator.bodySchema> = {
          datasourceId: "ds_abc123",
          tags: ["checkout"],
          projects: ["proj_abc987"],
          sqlBuilder: {
            tableName: "users",
            timestampColumnName: "created_at",
            valueColumnName: "signed_up",
            conditions: [
              {
                value: "true",
                operator: "=",
                column: "signed_up",
              },
            ],
            identifierTypeColumns: [
              {
                columnName: "id",
                identifierType: "string",
              },
            ],
          },
          behavior: {
            goal: "decrease",
            windowSettings: {
              type: "lookback",
              windowUnit: "days",
              windowValue: 33,
              delayValue: 5,
              delayUnit: "hours",
            },
            riskThresholdSuccess: 5,
            riskThresholdDanger: 0.5,
            minPercentChange: 1,
            maxPercentChange: 50,
            minSampleSize: 200,
          },
          name: "My Cool Metric",
          description: "This is a metric with lots of fields",
          type: "count",
        };

        const result = postMetricApiPayloadToMetricInterface(
          input,
          organization,
          datasource,
        );

        expect(result.aggregation).toEqual(undefined);
        expect(result.conditions).toEqual([
          {
            column: "signed_up",
            operator: "=",
            value: "true",
          },
        ]);
        expect(result.datasource).toEqual("ds_abc123");
        expect(result.denominator).toBe(undefined);
        expect(result.description).toEqual(
          "This is a metric with lots of fields",
        );
        expect(result.ignoreNulls).toEqual(false);
        expect(result.inverse).toEqual(true);
        expect(result.name).toEqual("My Cool Metric");
        expect(result.organization).toEqual("org_abc123");
        expect(result.owner).toEqual("");
        expect(result.queries).toEqual([]);
        expect(result.queryFormat).toEqual("builder");
        expect(result.runStarted).toEqual(null);
        expect(result.sql).toEqual(undefined);
        expect(result.type).toEqual("count");
        expect(result.userIdTypes).toEqual(undefined);
        // More fields
        expect(result.projects).toEqual(["proj_abc987"]);
        expect(result.tags).toEqual(["checkout"]);
        expect(result.winRisk).toEqual(5);
        expect(result.loseRisk).toEqual(0.5);
        expect(result.minPercentChange).toEqual(1);
        expect(result.maxPercentChange).toEqual(50);
        expect(result.minSampleSize).toEqual(200);
        expect(result.cappingSettings.type).toEqual("");
        expect(result.cappingSettings.value).toEqual(0);
        expect(result.windowSettings.type).toEqual("lookback");
        expect(result.windowSettings.windowValue).toEqual(33);
        expect(result.windowSettings.windowUnit).toEqual("days");
        expect(result.windowSettings.delayValue).toEqual(5);
        expect(result.windowSettings.delayUnit).toEqual("hours");
        expect(result.column).toEqual("signed_up");
      });

      it("should handle deprecated fields when building a MetricInterface from a postMetric payload", () => {
        const input: z.infer<typeof postMetricValidator.bodySchema> = {
          datasourceId: "ds_abc123",
          tags: ["checkout"],
          projects: ["proj_abc987"],
          sqlBuilder: {
            tableName: "users",
            timestampColumnName: "created_at",
            valueColumnName: "signed_up",
            conditions: [
              {
                value: "true",
                operator: "=",
                column: "signed_up",
              },
            ],
            identifierTypeColumns: [
              {
                columnName: "id",
                identifierType: "string",
              },
            ],
          },
          behavior: {
            goal: "decrease",
            conversionWindowStart: 10,
            conversionWindowEnd: 50,
            cap: 1337,
            riskThresholdSuccess: 5,
            riskThresholdDanger: 0.5,
            minPercentChange: 1,
            maxPercentChange: 50,
            minSampleSize: 200,
          },
          name: "My Cool Metric",
          description: "This is a metric with lots of fields",
          type: "count",
        };

        const result = postMetricApiPayloadToMetricInterface(
          input,
          organization,
          datasource,
        );

        expect(result.cappingSettings.type).toEqual("absolute");
        expect(result.cappingSettings.value).toEqual(1337);
        expect(result.windowSettings.type).toEqual("conversion");
        expect(result.windowSettings.windowValue).toEqual(40);
        expect(result.windowSettings.windowUnit).toEqual("hours");
        expect(result.windowSettings.delayValue).toEqual(10);
        expect(result.windowSettings.delayUnit).toEqual("hours");
      });
      it("upgrades delayHours", () => {
        const input: z.infer<typeof postMetricValidator.bodySchema> = {
          datasourceId: "ds_abc123",
          tags: ["checkout"],
          projects: ["proj_abc987"],
          sqlBuilder: {
            tableName: "users",
            timestampColumnName: "created_at",
            valueColumnName: "signed_up",
            conditions: [
              {
                value: "true",
                operator: "=",
                column: "signed_up",
              },
            ],
            identifierTypeColumns: [
              {
                columnName: "id",
                identifierType: "string",
              },
            ],
          },
          behavior: {
            goal: "decrease",
            windowSettings: {
              type: "lookback",
              windowUnit: "days",
              windowValue: 33,
              delayHours: 5,
            },
            riskThresholdSuccess: 5,
            riskThresholdDanger: 0.5,
            minPercentChange: 1,
            maxPercentChange: 50,
            minSampleSize: 200,
          },
          name: "My Cool Metric",
          description: "This is a metric with lots of fields",
          type: "count",
        };

        const result = postMetricApiPayloadToMetricInterface(
          input,
          organization,
          datasource,
        );

        expect(result.windowSettings.delayValue).toEqual(5);
        expect(result.windowSettings.delayUnit).toEqual("hours");
      });
      it("ignores delayHours if delayValue also set", () => {
        const input: z.infer<typeof postMetricValidator.bodySchema> = {
          datasourceId: "ds_abc123",
          tags: ["checkout"],
          projects: ["proj_abc987"],
          sqlBuilder: {
            tableName: "users",
            timestampColumnName: "created_at",
            valueColumnName: "signed_up",
            conditions: [
              {
                value: "true",
                operator: "=",
                column: "signed_up",
              },
            ],
            identifierTypeColumns: [
              {
                columnName: "id",
                identifierType: "string",
              },
            ],
          },
          behavior: {
            goal: "decrease",
            windowSettings: {
              type: "lookback",
              windowUnit: "days",
              windowValue: 33,
              delayHours: 5,
              delayValue: 10,
            },
            riskThresholdSuccess: 5,
            riskThresholdDanger: 0.5,
            minPercentChange: 1,
            maxPercentChange: 50,
            minSampleSize: 200,
          },
          name: "My Cool Metric",
          description: "This is a metric with lots of fields",
          type: "count",
        };

        const result = postMetricApiPayloadToMetricInterface(
          input,
          organization,
          datasource,
        );

        expect(result.windowSettings.delayValue).toEqual(10);
        expect(result.windowSettings.delayUnit).toEqual("hours");
      });
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

    it("with minimum payload, should create a MetricInterface from a postMetric payload", () => {
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
        datasource,
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

describe("putMetricApiPayloadToMetricInterface", () => {
  describe("SQL datasource", () => {
    it("with minimum payload, should create a MetricInterface from a putMetric payload", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "select * from foo",
          userAggregationSQL: "sum(values)",
        },
        name: "My Updated Metric",
        type: "binomial",
      };

      const result = putMetricApiPayloadToMetricInterface(input);

      expect(result.aggregation).toEqual("sum(values)");
      expect(result.conditions).toBe(undefined);
      expect(result.datasource).toBe(undefined);
      expect(result.denominator).toBe(undefined);
      expect(result.description).toBe(undefined);
      expect(result.ignoreNulls).toBe(undefined);
      expect(result.inverse).toBe(undefined);
      expect(result.name).toEqual("My Updated Metric");
      expect(result.organization).toBe(undefined);
      expect(result.owner).toBe(undefined);
      expect(result.projects).toBe(undefined);
      expect(result.tags).toBe(undefined);
      expect(result.queries).toBe(undefined);
      expect(result.queryFormat).toEqual("sql");
      expect(result.runStarted).toBe(undefined);
      expect(result.sql).toEqual("select * from foo");
      expect(result.type).toEqual("binomial");
      expect(result.userIdTypes).toEqual(["user_id"]);
    });

    it("with a full payload, should create a MetricInterface from a putMetric payload", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
        tags: ["checkout"],
        projects: ["proj_abc987"],
        sqlBuilder: {
          tableName: "users",
          timestampColumnName: "created_at",
          valueColumnName: "signed_up",
          conditions: [
            {
              value: "true",
              operator: "=",
              column: "signed_up",
            },
          ],
          identifierTypeColumns: [
            {
              columnName: "id",
              identifierType: "string",
            },
          ],
        },
        behavior: {
          goal: "decrease",
          conversionWindowStart: 10,
          conversionWindowEnd: 50,
          capping: "absolute",
          capValue: 1337,
          riskThresholdSuccess: 5,
          riskThresholdDanger: 0.5,
          minPercentChange: 1,
          maxPercentChange: 50,
          minSampleSize: 200,
        },
        name: "My Updated Metric",
        description: "This is a metric with lots of fields",
        type: "count",
      };

      const result = putMetricApiPayloadToMetricInterface(input);

      expect(result.aggregation).toEqual(undefined);
      expect(result.conditions).toEqual([
        {
          column: "signed_up",
          operator: "=",
          value: "true",
        },
      ]);
      expect(result.datasource).toBe(undefined);
      expect(result.denominator).toBe(undefined);
      expect(result.description).toEqual(
        "This is a metric with lots of fields",
      );
      expect(result.ignoreNulls).toBe(undefined);
      expect(result.inverse).toEqual(true);
      expect(result.name).toEqual("My Updated Metric");
      expect(result.organization).toBe(undefined);
      expect(result.owner).toBe(undefined);
      expect(result.queries).toBe(undefined);
      expect(result.queryFormat).toEqual("builder");
      expect(result.runStarted).toBe(undefined);
      expect(result.sql).toEqual(undefined);
      expect(result.type).toEqual("count");
      expect(result.userIdTypes).toEqual(undefined);
      // More fields
      expect(result.projects).toEqual(["proj_abc987"]);
      expect(result.tags).toEqual(["checkout"]);
      expect(result.winRisk).toEqual(5);
      expect(result.loseRisk).toEqual(0.5);
      expect(result.minPercentChange).toEqual(1);
      expect(result.maxPercentChange).toEqual(50);
      expect(result.minSampleSize).toEqual(200);
      expect(result.cappingSettings?.type).toEqual("absolute");
      expect(result.cappingSettings?.value).toEqual(1337);
      expect(result.windowSettings?.windowValue).toEqual(40);
      expect(result.windowSettings?.windowUnit).toEqual("hours");
      expect(result.windowSettings?.delayValue).toEqual(10);
      expect(result.windowSettings?.delayUnit).toEqual("hours");
      expect(result.column).toEqual("signed_up");
    });
  });

  describe("mixpanel datasource", () => {
    it("with minimum payload, should create a MetricInterface from a putMetric payload", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
        mixpanel: {
          eventName: "viewed_signup",
          eventValue: "did_view",
          userAggregation: "sum(values)",
          conditions: [],
        },
        name: "My Cool Metric",
        type: "count",
      };

      const result = putMetricApiPayloadToMetricInterface(input);

      expect(result.aggregation).toEqual("sum(values)");
      expect(result.conditions).toEqual([]);
      expect(result.datasource).toBe(undefined);
      expect(result.denominator).toBe(undefined);
      expect(result.description).toBe(undefined);
      expect(result.ignoreNulls).toBe(undefined);
      expect(result.inverse).toBe(undefined);
      expect(result.name).toEqual("My Cool Metric");
      expect(result.organization).toBe(undefined);
      expect(result.owner).toBe(undefined);
      expect(result.projects).toBe(undefined);
      expect(result.tags).toBe(undefined);
      expect(result.queries).toBe(undefined);
      expect(result.queryFormat).toBe(undefined);
      expect(result.runStarted).toBe(undefined);
      expect(result.sql).toBe(undefined);
      expect(result.type).toEqual("count");
      expect(result.userIdTypes).toEqual(undefined);
    });
  });

  describe("no specified datasource", () => {
    it("with minimum payload, should create a MetricInterface from a putMetric payload", () => {
      const input: z.infer<typeof putMetricValidator.bodySchema> = {
        name: "My Cool Metric",
        type: "count",
      };

      const result = putMetricApiPayloadToMetricInterface(input);

      expect(result.aggregation).toBe(undefined);
      expect(result.conditions).toBe(undefined);
      expect(result.datasource).toBe(undefined);
      expect(result.denominator).toBe(undefined);
      expect(result.description).toBe(undefined);
      expect(result.ignoreNulls).toBe(undefined);
      expect(result.inverse).toBe(undefined);
      expect(result.name).toEqual("My Cool Metric");
      expect(result.organization).toBe(undefined);
      expect(result.owner).toBe(undefined);
      expect(result.projects).toBe(undefined);
      expect(result.tags).toBe(undefined);
      expect(result.queries).toBe(undefined);
      expect(result.queryFormat).toBe(undefined);
      expect(result.runStarted).toBe(undefined);
      expect(result.sql).toBe(undefined);
      expect(result.type).toEqual("count");
      expect(result.userIdTypes).toEqual(undefined);
    });
  });
});

describe("incremental refresh mutex", () => {
  describe("buildSnapshotRefreshIntent", () => {
    it("should build intent for manual trigger", () => {
      const intent = buildSnapshotRefreshIntent({
        triggeredBy: "manual",
        useCache: true,
        isApiRequest: false,
        reweight: false,
      });

      expect(intent.requestedByManual).toBe(true);
      expect(intent.requestedBySchedule).toBe(false);
      expect(intent.requestedByApi).toBe(false);
      expect(intent.forceFullRefresh).toBe(false);
      expect(intent.banditReweightRequested).toBe(false);
      expect(intent.scheduledBanditEffectsPending).toBe(false);
      expect(intent.lastManualRequestDate).toBeInstanceOf(Date);
      expect(intent.lastScheduledRequestDate).toBeUndefined();
    });

    it("should preserve dashboard refresh requests separately", () => {
      const intent = buildSnapshotRefreshIntent({
        triggeredBy: "manual-dashboard",
        useCache: false,
        isApiRequest: false,
        reweight: false,
      });

      expect(intent.requestedByManual).toBe(true);
      expect(intent.requestedByDashboard).toBe(true);
      expect(intent.forceFullRefresh).toBe(true);
    });

    it("should build intent for scheduled trigger", () => {
      const intent = buildSnapshotRefreshIntent({
        triggeredBy: "schedule",
        useCache: true,
        isApiRequest: false,
        reweight: true,
      });

      expect(intent.requestedByManual).toBe(false);
      expect(intent.requestedBySchedule).toBe(true);
      expect(intent.requestedByApi).toBe(false);
      expect(intent.forceFullRefresh).toBe(false);
      expect(intent.banditReweightRequested).toBe(true);
      expect(intent.scheduledBanditEffectsPending).toBe(true);
      expect(intent.lastManualRequestDate).toBeUndefined();
      expect(intent.lastScheduledRequestDate).toBeInstanceOf(Date);
    });

    it("should build intent for API request with force refresh", () => {
      const intent = buildSnapshotRefreshIntent({
        triggeredBy: "manual",
        useCache: false,
        isApiRequest: true,
        reweight: undefined,
      });

      expect(intent.requestedByManual).toBe(true);
      expect(intent.requestedByApi).toBe(true);
      expect(intent.forceFullRefresh).toBe(true);
      expect(intent.banditReweightRequested).toBe(false);
    });
  });

  describe("mergeSnapshotRefreshIntent", () => {
    it("should OR boolean flags from existing and incoming", () => {
      const existing: ExperimentSnapshotRefreshIntent = {
        requestedByManual: true,
        requestedBySchedule: false,
        requestedByApi: false,
        requestedByDashboard: false,
        forceFullRefresh: false,
        banditReweightRequested: false,
        scheduledBanditEffectsPending: false,
      };
      const incoming: ExperimentSnapshotRefreshIntent = {
        requestedByManual: false,
        requestedBySchedule: true,
        requestedByApi: false,
        requestedByDashboard: true,
        forceFullRefresh: false,
        banditReweightRequested: true,
        scheduledBanditEffectsPending: true,
      };

      const merged = mergeSnapshotRefreshIntent(existing, incoming);

      expect(merged.requestedByManual).toBe(true);
      expect(merged.requestedBySchedule).toBe(true);
      expect(merged.requestedByApi).toBe(false);
      expect(merged.requestedByDashboard).toBe(true);
      expect(merged.forceFullRefresh).toBe(false);
      expect(merged.banditReweightRequested).toBe(true);
      expect(merged.scheduledBanditEffectsPending).toBe(true);
    });

    it("should use incoming date fields when present", () => {
      const existingDate = new Date("2024-01-01");
      const incomingDate = new Date("2024-06-15");

      const existing: ExperimentSnapshotRefreshIntent = {
        lastManualRequestDate: existingDate,
        lastScheduledRequestDate: existingDate,
      };
      const incoming: ExperimentSnapshotRefreshIntent = {
        lastManualRequestDate: incomingDate,
      };

      const merged = mergeSnapshotRefreshIntent(existing, incoming);

      expect(merged.lastManualRequestDate).toBe(incomingDate);
      expect(merged.lastScheduledRequestDate).toBe(existingDate);
    });

    it("should fall back to existing date fields when incoming is undefined", () => {
      const existingDate = new Date("2024-01-01");

      const existing: ExperimentSnapshotRefreshIntent = {
        lastManualRequestDate: existingDate,
        lastScheduledRequestDate: existingDate,
      };
      const incoming: ExperimentSnapshotRefreshIntent = {};

      const merged = mergeSnapshotRefreshIntent(existing, incoming);

      expect(merged.lastManualRequestDate).toBe(existingDate);
      expect(merged.lastScheduledRequestDate).toBe(existingDate);
    });

    it("should handle both intents having all fields set", () => {
      const date1 = new Date("2024-01-01");
      const date2 = new Date("2024-06-15");

      const existing: ExperimentSnapshotRefreshIntent = {
        requestedByManual: true,
        requestedBySchedule: true,
        requestedByApi: true,
        requestedByDashboard: true,
        forceFullRefresh: true,
        banditReweightRequested: true,
        scheduledBanditEffectsPending: true,
        lastManualRequestDate: date1,
        lastScheduledRequestDate: date1,
      };
      const incoming: ExperimentSnapshotRefreshIntent = {
        requestedByManual: true,
        requestedBySchedule: true,
        requestedByApi: true,
        requestedByDashboard: true,
        forceFullRefresh: true,
        banditReweightRequested: true,
        scheduledBanditEffectsPending: true,
        lastManualRequestDate: date2,
        lastScheduledRequestDate: date2,
      };

      const merged = mergeSnapshotRefreshIntent(existing, incoming);

      expect(merged.requestedByManual).toBe(true);
      expect(merged.requestedBySchedule).toBe(true);
      expect(merged.requestedByApi).toBe(true);
      expect(merged.requestedByDashboard).toBe(true);
      expect(merged.forceFullRefresh).toBe(true);
      expect(merged.banditReweightRequested).toBe(true);
      expect(merged.scheduledBanditEffectsPending).toBe(true);
      expect(merged.lastManualRequestDate).toBe(date2);
      expect(merged.lastScheduledRequestDate).toBe(date2);
    });

    it("should handle empty intents", () => {
      const merged = mergeSnapshotRefreshIntent({}, {});

      expect(merged.requestedByManual).toBe(false);
      expect(merged.requestedBySchedule).toBe(false);
      expect(merged.requestedByApi).toBe(false);
      expect(merged.requestedByDashboard).toBe(false);
      expect(merged.forceFullRefresh).toBe(false);
      expect(merged.banditReweightRequested).toBe(false);
      expect(merged.scheduledBanditEffectsPending).toBe(false);
      expect(merged.lastManualRequestDate).toBeUndefined();
      expect(merged.lastScheduledRequestDate).toBeUndefined();
    });
  });

  describe("getFollowupStandardSnapshotExecution", () => {
    it("should not replay when the running execution already covers the request", () => {
      const followup = getFollowupStandardSnapshotExecution({
        executionIntent: {
          forceFullRefresh: true,
          banditReweightRequested: true,
          requestedByManual: true,
        },
        mergedIntent: {
          forceFullRefresh: true,
          banditReweightRequested: true,
          requestedByManual: true,
        },
      });

      expect(followup).toBeNull();
    });

    it("should request a manual full-refresh replay when force refresh arrives mid-run", () => {
      const followup = getFollowupStandardSnapshotExecution({
        executionIntent: {
          forceFullRefresh: false,
          banditReweightRequested: false,
          requestedBySchedule: true,
        },
        mergedIntent: {
          forceFullRefresh: true,
          banditReweightRequested: false,
          requestedByManual: true,
          requestedBySchedule: true,
        },
      });

      expect(followup).toEqual({
        triggeredBy: "manual",
        useCache: false,
        reweight: false,
      });
    });

    it("should keep dashboard follow-up executions scoped to dashboards", () => {
      const followup = getFollowupStandardSnapshotExecution({
        executionIntent: {
          forceFullRefresh: false,
          banditReweightRequested: false,
          requestedByDashboard: false,
        },
        mergedIntent: {
          forceFullRefresh: true,
          banditReweightRequested: false,
          requestedByManual: true,
          requestedByDashboard: true,
        },
      });

      expect(followup).toEqual({
        triggeredBy: "manual-dashboard",
        useCache: false,
        reweight: false,
      });
    });
  });
});
