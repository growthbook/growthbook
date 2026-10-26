import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { MergeResultChanges } from "shared/util";
import { prevalidatePublishRevision } from "back-end/src/models/FeatureModel";
import { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/enterprise/sandbox/sandbox-eval", () => ({
  runValidateFeatureHooks: jest.fn(async () => undefined),
  runValidateFeatureRevisionHooks: jest.fn(async () => undefined),
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
  org: { id: "org", settings: { environments: [] } },
  auditUser: { type: "dashboard", id: "u_1" },
  canSkipSchemaValidationFor: () => false,
} as unknown as ReqContext;

const feature = (overrides: Partial<FeatureInterface>) =>
  ({
    id: "schema-feature",
    organization: "org",
    version: 1,
    valueType: "json",
    defaultValue: "{}",
    rules: [],
    environmentSettings: {},
    ...overrides,
  }) as unknown as FeatureInterface;

const prevalidate = (live: FeatureInterface, result: MergeResultChanges) =>
  prevalidatePublishRevision({
    context,
    feature: live,
    revision: { version: 2, status: "draft" } as FeatureRevisionInterface,
    result,
  });

describe("prevalidatePublishRevision with a staged JSON schema", () => {
  it("rejects unchanged live values a tightened staged schema forbids", async () => {
    await expect(
      prevalidate(feature({ jsonSchema: loose }), {
        metadata: { jsonSchema: tight },
      }),
    ).rejects.toThrow("Default value");
  });

  it("accepts a changed value that only the loosened staged schema allows", async () => {
    await expect(
      prevalidate(feature({ jsonSchema: tight }), {
        defaultValue: '{"size":1}',
        metadata: { jsonSchema: loose },
      }),
    ).resolves.toBeUndefined();
  });

  it("still skips unchanged values when the staged schema matches live", async () => {
    await expect(
      prevalidate(feature({ jsonSchema: tight }), {
        metadata: { jsonSchema: { ...tight, date: new Date(0) } },
      }),
    ).resolves.toBeUndefined();
  });
});
