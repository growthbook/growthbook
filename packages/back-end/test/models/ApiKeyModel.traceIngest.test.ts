import { TRACE_INGEST_ROLE_ID } from "shared/permissions";
import { ApiKeyInterface } from "shared/types/apikey";
import "back-end/src/services/context";
import { ApiKeyModel } from "back-end/src/models/ApiKeyModel";
import { getBackendFeatureValue } from "back-end/src/services/growthbook";

jest.mock("back-end/src/services/growthbook", () => ({
  getBackendFeatureValue: jest.fn(),
  getTrustedOrgAttributes: jest.fn(() => ({})),
}));

const flag = jest.mocked(getBackendFeatureValue);

function model() {
  const m = Object.create(ApiKeyModel.prototype) as ApiKeyModel;
  Object.assign(m, {
    context: {
      org: { id: "org_1", settings: {} },
      hasPremiumFeature: () => true,
      throwBadRequestError: (message: string) => {
        throw new Error(message);
      },
    },
  });
  return m as unknown as {
    customValidation(
      doc: Partial<ApiKeyInterface>,
      previousDoc?: Partial<ApiKeyInterface>,
    ): Promise<void>;
  };
}

const traceKey: Partial<ApiKeyInterface> = {
  secret: true,
  role: TRACE_INGEST_ROLE_ID,
  description: "traces",
};

describe("trace ingest keys", () => {
  it("can't be created while the trace-ingest flag is off", async () => {
    flag.mockReturnValue(false);
    await expect(model().customValidation(traceKey)).rejects.toThrow(
      "Trace ingest keys aren't available for this organization.",
    );
  });

  it("can be created with the flag on", async () => {
    flag.mockReturnValue(true);
    await expect(model().customValidation(traceKey)).resolves.toBeUndefined();
  });

  it("stay editable after the flag is turned off", async () => {
    flag.mockReturnValue(false);
    await expect(
      model().customValidation(
        { ...traceKey, disabled: true },
        { ...traceKey, description: "old" },
      ),
    ).resolves.toBeUndefined();
  });
});
