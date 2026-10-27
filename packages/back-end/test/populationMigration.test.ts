import {
  populationValidator,
  apiPopulationValidator,
  apiUpdatePopulationBody,
} from "shared/validators";
import { migratePopulation } from "../src/util/population-migration";

const current = {
  id: "pop_test",
  organization: "org_test",
  dateCreated: new Date(0),
  dateUpdated: new Date(0),
  name: "Active users",
  description: "",
  owner: "u_1",
  projects: [],
  datasource: "ds_test",
  userIdTypes: ["user_id"],
  steps: [
    {
      source: { type: "factTable", factTableId: "ftb_events" },
      rowFilters: [],
      aggregateFilter: ">=3",
      aggregateFilterColumn: "$$count",
    },
  ],
};

it.each(["", "lookback", "conversion"])(
  "removes legacy %s windows without mutating stored data",
  (type) => {
    const legacy = {
      ...current,
      steps: current.steps.map((step) => ({
        ...step,
        windowSettings: { type, windowValue: 7, windowUnit: "days" },
      })),
    };
    const migrated = migratePopulation(legacy);
    expect(migrated).toEqual(current);
    expect(legacy.steps[0]).toHaveProperty("windowSettings");
    expect(populationValidator.safeParse(migrated).success).toBe(true);
    expect(apiPopulationValidator.shape.steps.parse(migrated.steps)).toEqual(
      current.steps,
    );
    expect(
      apiUpdatePopulationBody.parse({ steps: migrated.steps }).steps,
    ).toEqual(current.steps);
    expect(migratePopulation(migrated)).toEqual(current);
  },
);

it("preserves current documents", () => {
  expect(migratePopulation(current)).toEqual(current);
});

it("does not add steps to projected documents", () => {
  expect(migratePopulation({ id: "pop_test", name: "Active users" })).toEqual({
    id: "pop_test",
    name: "Active users",
  });
});
