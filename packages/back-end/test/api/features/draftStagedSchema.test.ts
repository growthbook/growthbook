import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { OrganizationInterface } from "shared/types/organization";
import type { ApiReqContext } from "back-end/types/api";
import { setRevisionDefaultValue } from "back-end/src/api/features/putFeatureRevisionDefaultValue";
import { resolveOrCreateRevision } from "back-end/src/api/features/validations";
import { getFeature } from "back-end/src/models/FeatureModel";
import { updateRevision } from "back-end/src/models/FeatureRevisionModel";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: jest.fn(async () => null),
  updateRevision: jest.fn(async () => undefined),
}));
jest.mock("back-end/src/services/featureRevisionEvents", () => ({
  recordRevisionUpdate: jest.fn(async () => undefined),
}));
jest.mock("back-end/src/api/features/validations", () => ({
  ...jest.requireActual("back-end/src/api/features/validations"),
  resolveOrCreateRevision: jest.fn(),
  discardIfJustCreated: jest.fn(async () => undefined),
}));

const schema = (json: object) => ({
  schemaType: "schema" as const,
  schema: JSON.stringify(json),
  simple: { type: "object" as const, fields: [] },
  date: new Date(),
  enabled: true,
});
const loose = schema({ type: "object" });
const tight = schema({ type: "object", required: ["color"] });

const context = {
  permissions: { canEditFeatureDrafts: () => true },
  canSkipSchemaValidationFor: () => false,
} as unknown as ApiReqContext;
const org = { id: "org" } as OrganizationInterface;

function setup(
  liveSchema: FeatureInterface["jsonSchema"],
  stagedSchema: FeatureInterface["jsonSchema"],
) {
  jest.mocked(getFeature).mockResolvedValue({
    id: "schema-feature",
    organization: "org",
    valueType: "json",
    defaultValue: "{}",
    rules: [],
    jsonSchema: liveSchema,
  } as unknown as FeatureInterface);
  jest.mocked(resolveOrCreateRevision).mockResolvedValue({
    revision: {
      version: 2,
      status: "draft",
      defaultValue: "{}",
      metadata: { jsonSchema: stagedSchema },
    } as FeatureRevisionInterface,
    created: false,
  });
}

const write = (defaultValue: string) =>
  setRevisionDefaultValue(
    context,
    org,
    { id: "schema-feature", version: 2 },
    { defaultValue },
  );

describe("REST draft writes validate against the draft's staged schema", () => {
  beforeEach(() => jest.mocked(updateRevision).mockClear());

  it("rejects a default value the tightened staged schema forbids", async () => {
    setup(loose, tight);
    await expect(write('{"size":1}')).rejects.toThrow("color");
    expect(updateRevision).not.toHaveBeenCalled();
  });

  it("accepts a default value only the loosened staged schema allows", async () => {
    setup(tight, loose);
    await write('{"size":1}');
    expect(updateRevision).toHaveBeenCalledTimes(1);
  });
});
