import { z } from "zod";
import {
  postExperimentValidator,
  postMetricValidator,
  putMetricValidator,
  updateExperimentValidator,
} from "shared/validators";
import { DataSourceInterface } from "shared/types/datasource";
import { ExperimentInterface, Variation } from "shared/types/experiment";
import { OrganizationInterface } from "shared/types/organization";
import {
  applyVariationWeightsToLatestPhase,
  fillEmptyVariationKeys,
  normalizeStatusUpdateScheduleChanges,
  postExperimentApiPayloadToInterface,
  postMetricApiPayloadIsValid,
  postMetricApiPayloadToMetricInterface,
  putMetricApiPayloadIsValid,
  putMetricApiPayloadToMetricInterface,
  updateExperimentApiPayloadToInterface,
  validateStatusUpdateSchedule,
  validateVariationIds,
} from "back-end/src/services/experiments";

describe("experiments utils", () => {
  describe("validateVariationIds", () => {
    it("resolves variationId aliases while preferring explicit ids", () => {
      const variations = [
        { id: "control", variationId: "ignored", key: "0" },
        { variationId: "treatment", key: "1" },
        { key: "2" },
      ];

      validateVariationIds(variations);

      expect(variations[0].id).toBe("control");
      expect(variations[1].id).toBe("treatment");
      expect(variations[2].id).toMatch(/^var_/);
    });

    it("rejects duplicate resolved variation ids", () => {
      expect(() =>
        validateVariationIds([
          { id: "duplicate", key: "0" },
          { variationId: "duplicate", key: "1" },
        ]),
      ).toThrow("Variation IDs must be unique.");
    });
  });

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

  describe("updateExperimentApiPayloadToInterface", () => {
    const organization = {
      id: "org_123",
      settings: {},
    } as unknown as OrganizationInterface;

    function makeExperiment(): ExperimentInterface {
      return {
        id: "exp_123",
        organization: "org_123",
        trackingKey: "exp_123",
        name: "Test Experiment",
        type: "standard",
        project: "proj_1",
        hypothesis: "",
        description: "",
        tags: [],
        owner: "",
        dateCreated: new Date("2026-01-01T00:00:00.000Z"),
        dateUpdated: new Date("2026-01-01T00:00:00.000Z"),
        archived: false,
        status: "running",
        autoSnapshots: false,
        hashAttribute: "id",
        hashVersion: 2,
        disableStickyBucketing: false,
        variations: [
          {
            id: "v0",
            key: "control",
            name: "Control",
            description: "",
            screenshots: [],
          },
          {
            id: "v1",
            key: "treatment",
            name: "Treatment",
            description: "",
            screenshots: [],
          },
        ],
        phases: [
          {
            name: "Main",
            dateStarted: new Date("2026-01-01T00:00:00.000Z"),
            dateEnded: undefined,
            reason: "",
            seed: "seed_123",
            coverage: 1,
            variationWeights: [0.5, 0.5],
            condition: "{}",
            savedGroups: [],
            prerequisites: [],
            namespace: {
              enabled: false,
              name: "",
              range: [0, 1],
            },
            variations: [
              { id: "v1", status: "stopped" },
              { id: "v0", status: "active" },
            ],
          },
        ],
        goalMetrics: [],
        secondaryMetrics: [],
        guardrailMetrics: [],
        regressionAdjustmentEnabled: false,
        sequentialTestingEnabled: false,
        shareLevel: "organization",
        linkedFeatures: [],
        hasVisualChangesets: false,
        hasURLRedirects: false,
      } as unknown as ExperimentInterface;
    }

    it("does not overwrite phase variations on phases-only updates", () => {
      const experiment = makeExperiment();
      const changes = updateExperimentApiPayloadToInterface(
        {
          phases: [
            {
              name: "Main",
              dateStarted: "2026-02-01T00:00:00.000Z",
              variations: [{ id: "v0" }, { id: "v1" }],
            },
          ],
        },
        experiment,
        new Map(),
        organization,
      );

      expect(changes.variations).toBe(undefined);
      expect(changes.phases?.[0].variations).toEqual([
        { id: "v1", status: "stopped" },
        { id: "v0", status: "active" },
      ]);
    });

    it("synchronizes existing phases when only top-level variations are updated", () => {
      const experiment = makeExperiment();
      const changes = updateExperimentApiPayloadToInterface(
        {
          variations: [
            { id: "v0", key: "control", name: "Control" },
            { id: "v1", key: "treatment", name: "Treatment" },
            { id: "v2", key: "new", name: "New" },
          ],
        },
        experiment,
        new Map(),
        organization,
      );

      expect(changes.phases?.[0].variations).toEqual([
        { id: "v0", status: "active" },
        { id: "v1", status: "active" },
        { id: "v2", status: "active" },
      ]);
    });

    it("uses top-level variation order and preserves phase statuses by id in mixed updates", () => {
      const experiment = makeExperiment();
      const changes = updateExperimentApiPayloadToInterface(
        {
          variations: [
            { id: "v1", key: "treatment", name: "Treatment" },
            { id: "v0", key: "control", name: "Control" },
          ],
          phases: [
            {
              name: "Main",
              dateStarted: "2026-02-01T00:00:00.000Z",
              variations: [{ id: "v0" }, { id: "v1" }],
            },
          ],
        },
        experiment,
        new Map(),
        organization,
      );

      expect(changes.phases?.[0].variations).toEqual([
        { id: "v1", status: "active" },
        { id: "v0", status: "active" },
      ]);
    });

    it("does not overwrite phase variations when top-level variations are not provided", () => {
      const experiment = makeExperiment();
      const changes = updateExperimentApiPayloadToInterface(
        {
          phases: [
            {
              name: "Main",
              dateStarted: "2026-02-01T00:00:00.000Z",
            },
          ],
        },
        experiment,
        new Map(),
        organization,
      );

      expect(changes.phases?.[0].variations).toEqual([
        { id: "v1", status: "stopped" },
        { id: "v0", status: "active" },
      ]);
    });
  });

  describe("applyVariationWeightsToLatestPhase", () => {
    it("sets variationWeights on the last phase and preserves other phase fields", () => {
      const experiment = {
        phases: [
          {
            name: "Main",
            condition: "{}",
            variationWeights: [0.5, 0.5],
            coverage: 1,
            dateStarted: new Date("2024-01-01"),
          },
        ],
      } as ExperimentInterface;

      const next = applyVariationWeightsToLatestPhase(experiment, [0.6, 0.4]);

      expect(next).toHaveLength(1);
      expect(next[0].variationWeights).toEqual([0.6, 0.4]);
      expect(next[0].name).toEqual("Main");
      expect(next[0].coverage).toBe(1);
      expect(experiment.phases[0].variationWeights).toEqual([0.5, 0.5]);
    });

    it("only updates the last phase when multiple phases exist", () => {
      const experiment = {
        phases: [
          {
            name: "Ramp",
            condition: "{}",
            variationWeights: [0.5, 0.5],
            coverage: 0.2,
            dateStarted: new Date("2024-01-01"),
          },
          {
            name: "Main",
            condition: "{}",
            variationWeights: [0.5, 0.5],
            coverage: 1,
            dateStarted: new Date("2024-02-01"),
          },
        ],
      } as ExperimentInterface;

      const next = applyVariationWeightsToLatestPhase(experiment, [0.7, 0.3]);

      expect(next[0].variationWeights).toEqual([0.5, 0.5]);
      expect(next[1].variationWeights).toEqual([0.7, 0.3]);
    });
  });

  describe("experiment API payload mappers", () => {
    const org = { id: "org_test" } as OrganizationInterface;
    const datasource = {
      id: "ds_test",
      settings: { queries: { exposure: [{ id: "exp_query_1" }] } },
    } as DataSourceInterface;

    it("postExperimentApiPayloadToInterface maps metricOverrides and decisionFrameworkSettings", () => {
      const payload: z.infer<typeof postExperimentValidator.bodySchema> = {
        trackingKey: "track_b",
        name: "Experiment B",
        assignmentQueryId: "exp_query_1",
        variations: [
          { key: "0", name: "Control" },
          { key: "1", name: "Treatment" },
        ],
        metricOverrides: [
          {
            id: "met_1",
            delayHours: 12,
            winRisk: 0.05,
          },
        ],
        decisionFrameworkSettings: {
          decisionCriteriaId: "crit_1",
          decisionFrameworkMetricOverrides: [{ id: "met_1", targetMDE: 0.1 }],
        },
        postStratificationEnabled: false,
      };

      const out = postExperimentApiPayloadToInterface(payload, org, datasource);
      expect(out.metricOverrides).toEqual([
        { id: "met_1", delayHours: 12, winRisk: 0.05 },
      ]);
      expect(out.decisionFrameworkSettings).toEqual({
        decisionCriteriaId: "crit_1",
        decisionFrameworkMetricOverrides: [{ id: "met_1", targetMDE: 0.1 }],
      });
      expect(out.postStratificationEnabled).toBe(false);
    });

    it("postExperimentApiPayloadToInterface preserves variation ids and traffic splits", () => {
      const payload: z.infer<typeof postExperimentValidator.bodySchema> = {
        trackingKey: "track_ids",
        name: "Experiment with custom variation ids",
        assignmentQueryId: "exp_query_1",
        variations: [
          { id: "control", key: "0", name: "Control" },
          { variationId: "treatment", key: "1", name: "Treatment" },
        ],
        phases: [
          {
            name: "Main",
            dateStarted: "2026-07-23T00:00:00.000Z",
            trafficSplit: [
              { variationId: "treatment", weight: 0.25 },
              { variationId: "control", weight: 0.75 },
            ],
          },
        ],
      };

      const out = postExperimentApiPayloadToInterface(payload, org, datasource);

      expect(out.variations.map((variation) => variation.id)).toEqual([
        "control",
        "treatment",
      ]);
      expect(out.phases[0].variations).toEqual([
        { id: "control", status: "active" },
        { id: "treatment", status: "active" },
      ]);
      expect(out.phases[0].variationWeights).toEqual([0.75, 0.25]);
    });

    it("updateExperimentApiPayloadToInterface sets exposureQueryId from assignmentQueryId", () => {
      const experiment = {
        status: "draft",
        type: "standard",
        exposureQueryId: "old_query",
      } as unknown as ExperimentInterface;

      const payload: z.infer<typeof updateExperimentValidator.bodySchema> = {
        assignmentQueryId: "new_query",
      };

      const changes = updateExperimentApiPayloadToInterface(
        payload,
        experiment,
        new Map(),
        org,
      );
      expect(changes.exposureQueryId).toBe("new_query");
      expect(
        (changes as { assignmentQueryId?: string }).assignmentQueryId,
      ).toBe(undefined);
    });
  });
});

describe("normalizeStatusUpdateScheduleChanges", () => {
  function makeExperiment(
    overrides: Partial<ExperimentInterface> = {},
  ): ExperimentInterface {
    return {
      id: "exp_123",
      organization: "org_123",
      trackingKey: "exp_123",
      name: "Test",
      type: "standard",
      status: "draft",
      owner: "",
      tags: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
      archived: false,
      autoSnapshots: false,
      hashAttribute: "id",
      hashVersion: 2,
      disableStickyBucketing: false,
      variations: [],
      phases: [],
      goalMetrics: [],
      secondaryMetrics: [],
      guardrailMetrics: [],
      regressionAdjustmentEnabled: false,
      sequentialTestingEnabled: false,
      shareLevel: "organization",
      linkedFeatures: [],
      hasVisualChangesets: false,
      hasURLRedirects: false,
      nextScheduledStatusUpdate: null,
      statusUpdateSchedule: null,
      ...overrides,
    } as unknown as ExperimentInterface;
  }

  it("null clears both schedule and staged start", () => {
    const experiment = makeExperiment({
      statusUpdateSchedule: { startAt: new Date("2099-01-01") },
      nextScheduledStatusUpdate: {
        type: "start",
        date: new Date("2099-01-01"),
      },
    });
    const changes: Partial<ExperimentInterface> = {
      statusUpdateSchedule: null,
    };

    normalizeStatusUpdateScheduleChanges(experiment, changes);

    expect(changes.statusUpdateSchedule).toBeNull();
    expect(changes.nextScheduledStatusUpdate).toBeNull();
  });

  it("valid future startAt sets schedule and clears any staged start", () => {
    const future = new Date("2099-06-01T12:00:00Z");
    const experiment = makeExperiment({
      nextScheduledStatusUpdate: {
        type: "start",
        date: new Date("2099-01-01"),
      },
    });
    const changes: Partial<ExperimentInterface> = {
      statusUpdateSchedule: { startAt: future },
    };

    normalizeStatusUpdateScheduleChanges(experiment, changes);

    expect((changes.statusUpdateSchedule as { startAt: Date }).startAt).toEqual(
      future,
    );
    expect(changes.nextScheduledStatusUpdate).toBeNull();
  });

  it("object with no startAt clears both schedule and staged start", () => {
    const experiment = makeExperiment({
      statusUpdateSchedule: { startAt: new Date("2099-01-01") },
      nextScheduledStatusUpdate: {
        type: "start",
        date: new Date("2099-01-01"),
      },
    });
    const changes: Partial<ExperimentInterface> = {
      statusUpdateSchedule: {} as { startAt: Date },
    };

    normalizeStatusUpdateScheduleChanges(experiment, changes);

    expect(changes.statusUpdateSchedule).toBeNull();
    expect(changes.nextScheduledStatusUpdate).toBeNull();
  });

  it("status moving out of draft clears a pending staged start when no schedule key is present", () => {
    const experiment = makeExperiment({
      status: "draft",
      nextScheduledStatusUpdate: {
        type: "start",
        date: new Date("2099-01-01"),
      },
    });
    const changes: Partial<ExperimentInterface> = { status: "running" };

    normalizeStatusUpdateScheduleChanges(experiment, changes);

    expect(changes.nextScheduledStatusUpdate).toBeNull();
  });

  it("status staying draft does not clear a pending staged start", () => {
    const experiment = makeExperiment({
      status: "draft",
      nextScheduledStatusUpdate: {
        type: "start",
        date: new Date("2099-01-01"),
      },
    });
    const changes: Partial<ExperimentInterface> = { status: "draft" };

    normalizeStatusUpdateScheduleChanges(experiment, changes);

    expect(changes.nextScheduledStatusUpdate).toBeUndefined();
  });

  it("no schedule key and no status change leaves changes untouched", () => {
    const experiment = makeExperiment({
      nextScheduledStatusUpdate: {
        type: "start",
        date: new Date("2099-01-01"),
      },
    });
    const changes: Partial<ExperimentInterface> = { name: "renamed" };

    normalizeStatusUpdateScheduleChanges(experiment, changes);

    expect(changes.nextScheduledStatusUpdate).toBeUndefined();
  });
});

describe("fillEmptyVariationKeys", () => {
  const makeVariation = (key: string, id = `v_${key || "new"}`): Variation => ({
    id,
    name: key || "New",
    description: "",
    key,
    screenshots: [],
  });

  it("is a no-op when no variations have an empty key", () => {
    const variations = [makeVariation("0"), makeVariation("1")];
    const snapshot = variations.map((v) => ({ ...v }));

    fillEmptyVariationKeys(variations, ["0", "1"]);

    expect(variations).toEqual(snapshot);
  });

  it("is a no-op for an empty variations array", () => {
    const variations: Variation[] = [];

    fillEmptyVariationKeys(variations, ["0", "1"]);

    expect(variations).toEqual([]);
  });

  it("assigns the next numeric key for the typical sequential case", () => {
    const variations = [
      makeVariation("0"),
      makeVariation("1"),
      makeVariation(""),
    ];

    fillEmptyVariationKeys(variations, ["0", "1"]);

    expect(variations.map((v) => v.key)).toEqual(["0", "1", "2"]);
  });

  it("assigns monotonically increasing keys to multiple empties", () => {
    const variations = [
      makeVariation("0"),
      makeVariation("1"),
      makeVariation(""),
      makeVariation(""),
    ];

    fillEmptyVariationKeys(variations, ["0", "1"]);

    expect(variations.map((v) => v.key)).toEqual(["0", "1", "2", "3"]);
  });

  it("skips existing customized keys to avoid collision", () => {
    const variations = [
      makeVariation("0"),
      makeVariation("2"),
      makeVariation(""),
    ];

    fillEmptyVariationKeys(variations, ["0", "2"]);

    expect(variations.map((v) => v.key)).toEqual(["0", "2", "3"]);
  });

  it("starts at 0 when no existing keys are non-negative integers", () => {
    const variations = [
      makeVariation("control"),
      makeVariation("treatment"),
      makeVariation(""),
    ];

    fillEmptyVariationKeys(variations, ["control", "treatment"]);

    expect(variations.map((v) => v.key)).toEqual(["control", "treatment", "0"]);
  });

  it("uses the largest non-negative integer key in a mixed set", () => {
    const variations = [
      makeVariation("control"),
      makeVariation("5"),
      makeVariation(""),
    ];

    fillEmptyVariationKeys(variations, ["control", "5"]);

    expect(variations.map((v) => v.key)).toEqual(["control", "5", "6"]);
  });

  it("ignores non-canonical numeric strings when finding the largest", () => {
    const variations = [
      makeVariation("0"),
      makeVariation("007"),
      makeVariation("-1"),
      makeVariation("3.5"),
      makeVariation(""),
    ];

    fillEmptyVariationKeys(variations, ["0", "007", "-1", "3.5"]);

    expect(variations[variations.length - 1].key).toBe("1");
  });

  it("assigns 0 when there are no existing keys at all", () => {
    const variations = [makeVariation(""), makeVariation("")];

    fillEmptyVariationKeys(variations, []);

    expect(variations.map((v) => v.key)).toEqual(["0", "1"]);
  });

  it("does not modify variations whose key is already set", () => {
    const variations = [
      makeVariation("0"),
      makeVariation("custom"),
      makeVariation(""),
    ];

    fillEmptyVariationKeys(variations, ["0", "custom"]);

    expect(variations[0].key).toBe("0");
    expect(variations[1].key).toBe("custom");
    expect(variations[2].key).toBe("1");
  });
});

describe("validateStatusUpdateSchedule", () => {
  it("throws when experiment type is bandit and a schedule is provided", () => {
    expect(() =>
      validateStatusUpdateSchedule("multi-armed-bandit", {
        startAt: "2099-01-01T00:00:00Z",
      }),
    ).toThrow("Bandit experiments do not support scheduled starts.");
  });

  it("throws when startAt is in the past", () => {
    expect(() =>
      validateStatusUpdateSchedule("standard", {
        startAt: "2000-01-01T00:00:00Z",
      }),
    ).toThrow("statusUpdateSchedule.startAt must be in the future");
  });

  it("throws when effective type changes to bandit and a schedule exists", () => {
    const effectiveType = "multi-armed-bandit";
    expect(() =>
      validateStatusUpdateSchedule(effectiveType, {
        startAt: "2099-01-01T00:00:00Z",
      }),
    ).toThrow("Bandit experiments do not support scheduled starts.");
  });

  it("does not throw for a valid future startAt on a standard experiment", () => {
    expect(() =>
      validateStatusUpdateSchedule("standard", {
        startAt: "2099-01-01T00:00:00Z",
      }),
    ).not.toThrow();
  });
});
