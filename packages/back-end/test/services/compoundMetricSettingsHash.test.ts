import type {
  CompoundFactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { getMetricSettingsHashForIncrementalRefresh } from "back-end/src/enterprise/services/data-pipeline";
import { factMetricFactory } from "../factories/FactMetric.factory";
import { factTableFactory } from "../factories/FactTable.factory";

const savedFilter = (value: string) => ({
  id: "filter_trial",
  dateCreated: new Date("2023-01-01"),
  dateUpdated: new Date("2023-01-01"),
  name: "Trial",
  description: "",
  value,
});

const events = factTableFactory.build({
  id: "ft_events",
  sql: "SELECT user_id, timestamp, event_name FROM events",
});
const orders = factTableFactory.build({
  id: "ft_orders",
  sql: "SELECT user_id, timestamp, amount FROM orders",
  filters: [savedFilter("plan = 'trial'")],
});

const compound: CompoundFactMetricInterface = {
  ...factMetricFactory.build({ id: "fact__compound" }),
  metricType: "compound",
  numerator: null,
  funnelSettings: null,
  compoundSettings: {
    components: [
      {
        factTableId: events.id,
        rowFilters: [
          { column: "event_name", operator: "=", values: ["view_pricing"] },
        ],
      },
      {
        factTableId: orders.id,
        rowFilters: [{ operator: "saved_filter", values: ["filter_trial"] }],
      },
    ],
  },
};

const hashWith = (tables: FactTableInterface[]) =>
  getMetricSettingsHashForIncrementalRefresh({
    factMetric: compound,
    factTableMap: new Map(tables.map((t) => [t.id, t])),
  });

describe("getMetricSettingsHashForIncrementalRefresh for compound metrics", () => {
  const baseline = hashWith([events, orders]);

  it("is stable when nothing changes", () => {
    expect(hashWith([events, orders])).toEqual(baseline);
  });

  it("changes when a non-primary component's fact table SQL changes", () => {
    const editedOrders = {
      ...orders,
      sql: "SELECT user_id, timestamp, amount FROM orders_v2",
    };
    expect(hashWith([events, editedOrders])).not.toEqual(baseline);
  });

  it("changes when a saved filter used by a component changes", () => {
    const editedOrders = { ...orders, filters: [savedFilter("plan = 'pro'")] };
    expect(hashWith([events, editedOrders])).not.toEqual(baseline);
  });

  it("ignores saved filters no component references", () => {
    const unrelatedFilter = {
      ...savedFilter("amount > 0"),
      id: "filter_unused",
    };
    const editedOrders = {
      ...orders,
      filters: [...orders.filters, unrelatedFilter],
    };
    expect(hashWith([events, editedOrders])).toEqual(baseline);
  });
});
