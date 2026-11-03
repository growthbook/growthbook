import {
  matchConfirmRules,
  routeConfirmation,
} from "../src/util/confirmations";
import { confirmRulesValidator } from "../src/validators/confirmations";

const publishProd = {
  action: "feature.publish" as const,
  environments: ["production"],
};
const startAnywhere = { action: "experiment.start" as const, environments: [] };

describe("matchConfirmRules", () => {
  it("matches an action, or its category, in an overlapping environment", () => {
    expect(
      matchConfirmRules([{ actions: ["feature.publish"] }], [publishProd]),
    ).toEqual([publishProd]);
    expect(
      matchConfirmRules([{ actions: ["feature.*"] }], [publishProd]),
    ).toEqual([publishProd]);
    expect(
      matchConfirmRules([{ actions: ["*"] }], [publishProd, startAnywhere]),
    ).toEqual([publishProd, startAnywhere]);
    expect(
      matchConfirmRules(
        [{ actions: ["feature.publish"], environments: ["staging"] }],
        [publishProd],
      ),
    ).toEqual([]);
  });

  it("matches an action with no environments against any environment list", () => {
    expect(
      matchConfirmRules(
        [{ actions: ["experiment.start"], environments: ["production"] }],
        [startAnywhere, publishProd],
      ),
    ).toEqual([startAnywhere]);
  });

  it("matches the recommended set, which leaves out creating and drafting", () => {
    const recommended = [{ actions: ["recommended"] }];
    const createFlag = { action: "feature.create" as const, environments: [] };
    const draftFlag = { action: "feature.draft" as const, environments: [] };
    const editEnv = { action: "environment.edit" as const, environments: [] };
    expect(
      matchConfirmRules(recommended, [
        publishProd,
        createFlag,
        draftFlag,
        editEnv,
      ]),
    ).toEqual([publishProd, editEnv]);
  });

  it("holds nothing without a matching rule", () => {
    expect(matchConfirmRules([], [publishProd])).toEqual([]);
    expect(
      matchConfirmRules([{ actions: ["feature"] }], [publishProd]),
    ).toEqual([]);
  });
});

describe("routeConfirmation", () => {
  it("holds an undeclared write as its model's catch-all, or as other.write", () => {
    expect(routeConfirmation("post", ["configs"], undefined)).toEqual([
      "config.other",
    ]);
    expect(routeConfirmation("post", ["metrics"], undefined)).toEqual([
      "other.write",
    ]);
    expect(routeConfirmation("post", ["configs"], [])).toEqual([]);
    expect(routeConfirmation("get", ["configs"], undefined)).toEqual([]);
  });
});

describe("confirmRulesValidator", () => {
  it("takes everything, the recommended set, a whole model or one action, and rejects typos", () => {
    const valid = (actions: string[]) =>
      confirmRulesValidator.safeParse([{ actions }]).success;
    expect(valid(["*", "recommended", "override.*", "feature.publish"])).toBe(
      true,
    );
    expect(valid(["feature.publsh"])).toBe(false);
    expect(valid(["features.*"])).toBe(false);
  });
});
