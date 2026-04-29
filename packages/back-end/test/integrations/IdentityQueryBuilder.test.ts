import { ExposureQuery } from "shared/types/datasource";
import { IdentityQueryBuilder } from "back-end/src/integrations/queryBuilder/IdentityQueryBuilder";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";
import { factTableFactory } from "back-end/test/factories/FactTable.factory";

describe("IdentityQueryBuilder", () => {
  const exposureQuery: ExposureQuery = {
    id: "exp",
    name: "Exposure",
    description: "",
    query: "SELECT * FROM exposure",
    userIdType: "device_id",
    dimensions: [],
  };

  const factTableA = factTableFactory.build({
    id: "fact_a",
    userIdTypes: ["user_id"],
  });
  const factTableB = factTableFactory.build({
    id: "fact_b",
    userIdTypes: ["device_id", "user_id"],
  });
  const activationFactTable = factTableFactory.build({
    id: "activation_fact",
    userIdTypes: ["visitor_id"],
  });
  const ambiguousFactTable = factTableFactory.build({
    id: "fact_ambiguous",
    userIdTypes: ["visitor_id", "user_id"],
  });

  const metricA = factMetricFactory.build({
    numerator: { factTableId: factTableA.id },
  });
  const metricB = factMetricFactory.build({
    numerator: { factTableId: factTableB.id },
  });
  const activationMetric = factMetricFactory.build({
    numerator: { factTableId: activationFactTable.id },
  });
  const ambiguousMetric = factMetricFactory.build({
    numerator: { factTableId: ambiguousFactTable.id },
  });

  const factTableMap = new Map([
    [factTableA.id, factTableA],
    [factTableB.id, factTableB],
    [activationFactTable.id, activationFactTable],
    [ambiguousFactTable.id, ambiguousFactTable],
  ]);

  const builder = new IdentityQueryBuilder({
    identityJoins: [
      { ids: ["device_id", "visitor_id"] },
      { ids: ["device_id", "user_id"] },
    ],
    factTableMap,
    exposureQuery,
    activationMetric,
    forcedBaseIdType: "device_id",
  });

  it("builds units-only analysis joins from experiment context", () => {
    expect(builder.buildForAnalysis()).toEqual({
      baseIdType: "device_id",
      joinsRequired: ["visitor_id"],
      idJoinMap: {
        visitor_id: "__identities_visitor_id",
      },
    });
  });

  it("builds expected joins for group A analysis", () => {
    expect(builder.buildForAnalysis({ metrics: [metricA] })).toEqual({
      baseIdType: "device_id",
      joinsRequired: ["visitor_id", "user_id"],
      idJoinMap: {
        visitor_id: "__identities_visitor_id",
        user_id: "__identities_user_id",
      },
    });
  });

  it("builds expected joins for group B analysis", () => {
    expect(builder.buildForAnalysis({ metrics: [metricB] })).toEqual({
      baseIdType: "device_id",
      joinsRequired: ["visitor_id"],
      idJoinMap: {
        visitor_id: "__identities_visitor_id",
      },
    });
  });

  it("is stable for the same input", () => {
    const first = builder.buildForAnalysis({ metrics: [metricA] });
    const second = builder.buildForAnalysis({ metrics: [metricA] });
    expect(second).toEqual(first);
  });

  it("prefers activation-compatible join id for ambiguous metric ids", () => {
    expect(builder.buildForAnalysis({ metrics: [ambiguousMetric] })).toEqual({
      baseIdType: "device_id",
      joinsRequired: ["visitor_id"],
      idJoinMap: {
        visitor_id: "__identities_visitor_id",
      },
    });
  });
});
