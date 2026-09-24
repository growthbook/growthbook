import { describe, expect, it } from "vitest";
import type {
  ExperimentInterfaceStringDates,
  ExperimentTemplateInterface,
} from "shared/types/experiment";
import {
  convertExperimentToTemplate,
  convertTemplateToExperiment,
} from "@/services/experiments";

describe("convertExperimentToTemplate", () => {
  it("round-trips the assignment query identifier type", () => {
    const experiment = {
      name: "Checkout",
      datasource: "ds_1",
      exposureQueryId: "eq_1",
      exposureQueryIdentifierType: "user_id",
      phases: [{ coverage: 1, condition: "" }],
    } as unknown as ExperimentInterfaceStringDates;

    const template = convertExperimentToTemplate(experiment, {
      userIdType: "anonymous_id",
      userIdTypes: ["anonymous_id", "user_id"],
    });
    expect(template.exposureQueryIdentifierType).toBe("user_id");
    expect(
      convertTemplateToExperiment(template as ExperimentTemplateInterface)
        .exposureQueryIdentifierType,
    ).toBe("user_id");
  });

  it("stores a legacy experiment's resolved identifier type", () => {
    const experiment = {
      name: "Checkout",
      datasource: "ds_1",
      exposureQueryId: "eq_1",
      phases: [{ coverage: 1, condition: "" }],
    } as unknown as ExperimentInterfaceStringDates;

    const template = convertExperimentToTemplate(experiment, {
      userIdType: "anonymous_id",
      userIdTypes: ["user_id", "anonymous_id"],
    });
    expect(template.exposureQueryIdentifierType).toBe("anonymous_id");
  });
});
