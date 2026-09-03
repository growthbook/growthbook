import { NULL_DIMENSION_VALUE } from "shared/constants";
import type { DimensionInterface } from "shared/types/dimension";
import { redshiftDialect } from "back-end/src/integrations/dialects/redshift";
import { getDimensionCol } from "back-end/src/integrations/sql/columns/dimension-col";
import { concatSql } from "back-end/src/integrations/sql/primitives/concat";

describe("concatSql", () => {
  it("nests binary CONCAT so warehouses that reject 3+ arguments stay valid", () => {
    expect(concatSql()).toBe("''");
    expect(concatSql("a")).toBe("a");
    expect(concatSql("a", "b")).toBe("CONCAT(a, b)");
    expect(concatSql("a", "b", "c")).toBe("CONCAT(CONCAT(a, b), c)");
  });
});

describe("getDimensionCol combo", () => {
  it("emits nested binary CONCAT for a two-dimension combination", () => {
    const userDimension: DimensionInterface = {
      id: "dim_u1",
      organization: "org1",
      owner: "",
      datasource: "ds1",
      userIdType: "user_id",
      name: "Browser",
      sql: "SELECT user_id, browser AS value FROM users",
      dateCreated: null,
      dateUpdated: null,
    };

    const col = getDimensionCol(redshiftDialect, {
      type: "combo",
      dimensions: [
        { type: "experiment", id: "country" },
        { type: "user", dimension: userDimension },
      ],
    });

    expect(col.alias).toBe("dim_combo");
    expect(col.value).toBe(
      concatSql(
        `'country: '`,
        `COALESCE(cast(dim_exp_country as varchar), '${NULL_DIMENSION_VALUE}')`,
        `' & '`,
        `'Browser: '`,
        `COALESCE(cast(dim_unit_dim_u1 as varchar), '${NULL_DIMENSION_VALUE}')`,
      ),
    );
    expect(col.value.startsWith("CONCAT(CONCAT(")).toBe(true);
  });
});
