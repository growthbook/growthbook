import { describe, it, expect } from "vitest";
import type { FeatureInterface } from "shared/types/feature";
import { buildHookTestFunctionArgs } from "@/components/CustomHooks/customHookTestArgs";

const FEATURE = { tags: ["live"] } as Pick<FeatureInterface, "tags">;

describe("buildHookTestFunctionArgs", () => {
  it("recomputes tags on every call, overriding a stale sibling tags field", () => {
    // Simulates editing `metadata.tags` in the textarea without also updating
    // the `tags` field baked in when the panel first opened.
    const args = buildHookTestFunctionArgs(
      {
        revision: JSON.stringify({
          metadata: { tags: ["edited"] },
          tags: ["stale"],
        }),
      },
      "validateFeatureRevision",
      FEATURE,
    );

    expect(args.revision).toMatchObject({ tags: ["edited"] });
  });

  it("falls back to the feature's tags when metadata does not touch tags", () => {
    const args = buildHookTestFunctionArgs(
      { revision: JSON.stringify({ metadata: { description: "x" } }) },
      "validateFeatureRevision",
      FEATURE,
    );

    expect(args.revision).toMatchObject({ tags: ["live"] });
  });

  it("does not touch the revision arg for other hook types (e.g. validateConfigRevision)", () => {
    const configRevision = { version: 2, status: "approved" };
    const args = buildHookTestFunctionArgs(
      { revision: JSON.stringify(configRevision) },
      "validateConfigRevision",
      undefined,
    );

    expect(args.revision).toEqual(configRevision);
  });

  it("does not touch non-revision keys", () => {
    const args = buildHookTestFunctionArgs(
      { feature: JSON.stringify({ tags: ["a"] }) },
      "validateFeatureRevision",
      FEATURE,
    );

    expect(args.feature).toEqual({ tags: ["a"] });
  });

  it("passes through a value that fails to parse as JSON unchanged", () => {
    const args = buildHookTestFunctionArgs(
      { revision: "not json" },
      "validateFeatureRevision",
      FEATURE,
    );

    expect(args.revision).toBe("not json");
  });
});
