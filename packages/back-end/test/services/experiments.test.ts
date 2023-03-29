import { z } from "zod";
import { postMetricApiPayloadIsValid } from "../../src/services/experiments";
import { postMetricValidator } from "../../src/validators/openapi";

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

      const result = postMetricApiPayloadIsValid(input) as {
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
});
