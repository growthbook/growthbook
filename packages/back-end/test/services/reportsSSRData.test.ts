import { FactTableInterface } from "shared/types/fact-table";
import { redactFactTableForSSR } from "back-end/src/services/reports";

const date = new Date("2026-01-01");

const factTable: FactTableInterface = {
  organization: "org_1",
  id: "ft_1",
  dateCreated: date,
  dateUpdated: date,
  name: "Revenue",
  description: "",
  owner: "",
  projects: [],
  tags: [],
  datasource: "ds_1",
  userIdTypes: ["user_id"],
  userIdColumns: { user_id: "internal_uid" },
  sql: "SELECT secret_api_key FROM prod.internal_revenue",
  timestampColumn: "event_ts",
  eventName: "purchase",
  columns: [
    {
      dateCreated: date,
      dateUpdated: date,
      name: "Amount",
      description: "",
      column: "amount",
      datatype: "number",
      numberFormat: "currency",
      deleted: false,
      isVirtual: true,
      sql: "price * quantity",
      topValues: ["ACME"],
      topValuesDate: date,
      jsonFields: { secret: { datatype: "string" } },
      isAutoSliceColumn: true,
      autoSlices: ["US"],
    },
  ],
  filters: [
    {
      id: "flt_1",
      dateCreated: date,
      dateUpdated: date,
      name: "Region",
      description: "",
      value: "region='SECRET_REGION'",
    },
  ],
};

describe("redactFactTableForSSR", () => {
  it("strips SQL, schema and warehouse values", () => {
    const redacted = redactFactTableForSSR(factTable);
    const json = JSON.stringify(redacted);

    expect(json).not.toContain("secret_api_key");
    expect(json).not.toContain("SECRET_REGION");
    expect(json).not.toContain("price * quantity");
    expect(json).not.toContain("internal_uid");
    expect(json).not.toContain("event_ts");
    expect(json).not.toContain("ACME");
    expect(json).not.toContain("secret");
    expect(redacted.eventName).toBe("");
  });

  it("keeps what the results UI needs for formatting and slices", () => {
    const [column] = redactFactTableForSSR(factTable).columns;

    expect(column).toMatchObject({
      column: "amount",
      name: "Amount",
      datatype: "number",
      numberFormat: "currency",
      isAutoSliceColumn: true,
      autoSlices: ["US"],
    });
  });
});
