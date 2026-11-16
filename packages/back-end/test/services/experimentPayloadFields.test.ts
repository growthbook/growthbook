import type { InterleavingInterface } from "shared/validators";
import { interleavingUpdateNeedsRunPermission } from "back-end/src/services/experimentPayloadFields";

const interleaving = (status: InterleavingInterface["status"]) =>
  ({
    status,
    archived: false,
    trackingKey: "search-ranking",
    userIdType: "user_id",
    environmentSettings: { production: { enabled: true } },
  }) as InterleavingInterface;

describe("interleavingUpdateNeedsRunPermission", () => {
  it("requires it for a new tracking key on a serving experiment", () => {
    expect(
      interleavingUpdateNeedsRunPermission(interleaving("running"), {
        trackingKey: "search-v2",
      }),
    ).toBe(true);
  });

  // Clients may send the key with every save; only a different value counts.
  it("does not require it when the unchanged tracking key is sent", () => {
    expect(
      interleavingUpdateNeedsRunPermission(interleaving("running"), {
        trackingKey: "search-ranking",
        userIdType: "device_id",
      }),
    ).toBe(false);
  });

  it("does not require it for a new tracking key on a draft", () => {
    expect(
      interleavingUpdateNeedsRunPermission(interleaving("draft"), {
        trackingKey: "search-v2",
      }),
    ).toBe(false);
  });
});
