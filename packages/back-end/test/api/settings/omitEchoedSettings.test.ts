import { putSettingsValidator } from "shared/validators";
import {
  OrganizationInterface,
  OrganizationSettings,
} from "shared/types/organization";
import { toApiSettings } from "back-end/src/api/settings/getSettings";
import { omitEchoedSettings } from "back-end/src/api/settings/putSettings";

// Values the settings page allows but the write schemas reject.
const org = {
  id: "org_1",
  settings: {
    regressionAdjustmentDays: 7.5,
    testQueryDays: 0,
  } as OrganizationSettings,
} as unknown as OrganizationInterface;

const validate = (body: Record<string, unknown>) =>
  putSettingsValidator.bodySchema.safeParse(omitEchoedSettings(body, org))
    .success;

describe("omitEchoedSettings", () => {
  it("lets a whole GET response pass PUT validation", () => {
    const body = JSON.parse(JSON.stringify(toApiSettings(org)));
    expect(putSettingsValidator.bodySchema.safeParse(body).success).toBe(false);
    expect(validate(body)).toBe(true);
  });

  it("still validates a changed value", () => {
    expect(validate({ regressionAdjustmentDays: 2.5 })).toBe(false);
    expect(validate({ regressionAdjustmentDays: 14 })).toBe(true);
  });

  it("keeps resets and changed values", () => {
    expect(
      omitEchoedSettings(
        { regressionAdjustmentDays: null, testQueryDays: 30 },
        org,
      ),
    ).toEqual({ regressionAdjustmentDays: null, testQueryDays: 30 });
  });
});
