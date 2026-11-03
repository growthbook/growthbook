import type { FeatureInterface } from "shared/types/feature";
import {
  AddedFlag,
  addedFlagChanges,
} from "@/components/Experiment/TabbedPage/addedFlags";

const added: AddedFlag = {
  feature: { id: "flag" } as FeatureInterface,
  newFlag: null,
  values: [{ variationId: "v0", value: "a" }],
  sparse: false,
  environments: { allEnvironments: true, environments: [] },
  allowUnscopedRules: false,
};
const newFlag = {
  id: "flag",
  valueType: "string" as const,
  defaultValue: "a",
  environmentSettings: {},
};

describe("addedFlagChanges", () => {
  it("links an existing flag, and creates a new one", () => {
    const link = {
      variations: added.values,
      environments: added.environments,
    };
    expect(addedFlagChanges(added)).toEqual({
      linkFeatures: [{ featureId: "flag", ...link }],
    });
    expect(addedFlagChanges({ ...added, newFlag })).toEqual({
      createFeatures: [{ feature: newFlag, ...link }],
    });
  });

  it("sends the column's values and the acknowledgment it was added with", () => {
    const values = [{ variationId: "v0", value: "b" }];
    expect(
      addedFlagChanges({ ...added, allowUnscopedRules: true }, values, true),
    ).toEqual({
      allowUnscopedRules: true,
      linkFeatures: [
        {
          featureId: "flag",
          variations: values,
          sparse: true,
          environments: added.environments,
        },
      ],
    });
  });
});
