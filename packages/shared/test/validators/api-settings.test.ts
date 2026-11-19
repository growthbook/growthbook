import {
  apiApprovalFlows,
  putApprovalSettingsValidator,
} from "../../src/validators/api-settings";

describe("putApprovalSettingsValidator body", () => {
  const parse = (body: unknown) =>
    putApprovalSettingsValidator.bodySchema.safeParse(body);

  it("accepts an SDK-connection-only approval update", () => {
    const result = parse({
      approvalFlows: {
        sdkConnections: [{ required: true, environments: ["production"] }],
      },
    });
    expect(result.success).toBe(true);
    expect(result.data?.approvalFlows).toEqual({
      sdkConnections: [{ required: true, environments: ["production"] }],
    });
    // The handler spreads this over the stored families, so an omitted one
    // must not come through as an explicit undefined.
    expect(Object.keys(result.data?.approvalFlows ?? {})).toEqual([
      "sdkConnections",
    ]);
  });

  it("accepts a Saved-Group-only approval update as before", () => {
    const result = parse({
      approvalFlows: { savedGroups: [{ required: true }] },
    });
    expect(result.success).toBe(true);
    expect(result.data?.approvalFlows).toEqual({
      savedGroups: [{ required: true }],
    });
  });

  it("accepts both families together", () => {
    expect(
      parse({
        approvalFlows: {
          savedGroups: [{ required: false }],
          sdkConnections: [{ required: true }],
        },
      }).success,
    ).toBe(true);
  });

  it("rejects unknown approval families", () => {
    expect(parse({ approvalFlows: { segments: [] } }).success).toBe(false);
  });

  it("rejects environments on a Saved Group rule", () => {
    expect(
      parse({
        approvalFlows: {
          savedGroups: [{ required: true, environments: ["production"] }],
        },
      }).success,
    ).toBe(false);
  });
});

describe("approval flows response shape", () => {
  it("requires every family", () => {
    expect(apiApprovalFlows.safeParse({ savedGroups: [] }).success).toBe(false);
    expect(apiApprovalFlows.safeParse({ sdkConnections: [] }).success).toBe(
      false,
    );
    expect(
      apiApprovalFlows.safeParse({ savedGroups: [], sdkConnections: [] })
        .success,
    ).toBe(true);
  });

  it("is required in the update response", () => {
    expect(
      putApprovalSettingsValidator.responseSchema.safeParse({
        requireReviews: [],
        targetingReviewMode: [],
      }).success,
    ).toBe(false);
  });
});
