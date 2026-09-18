import { featureDocumentWentBack } from "back-end/src/models/FeatureModel";

/**
 * Whether a failed feature publish put the document back — the question that decides
 * its deferred `feature.updated`.
 *
 * The single-entity path compensates through its own rewind list rather than the
 * shared restore funnel, so it reports this itself.
 */
describe("featureDocumentWentBack", () => {
  it("is true when every rewind succeeded", () => {
    expect(
      featureDocumentWentBack({ ownershipLost: false, unreversed: [] }),
    ).toBe(true);
  });

  // Satellites can fail while the document itself goes back; the document's own event
  // must still be suppressed, and the satellites' events stand on their own.
  it("is true when only satellites could not be reversed", () => {
    expect(
      featureDocumentWentBack({
        ownershipLost: false,
        unreversed: ["ramp schedules", "holdout linkage"],
      }),
    ).toBe(true);
  });

  it("is false when the document rewind itself failed", () => {
    expect(
      featureDocumentWentBack({
        ownershipLost: false,
        unreversed: ["feature document"],
      }),
    ).toBe(false);
  });

  // A lost race: our write landed and a rival's followed it. Emitting keeps the diff
  // chain intact, since the rival's own event reports `previous` = our value.
  it("is false when a rival owns the document", () => {
    expect(
      featureDocumentWentBack({ ownershipLost: true, unreversed: [] }),
    ).toBe(false);
  });

  it("is false when ownership is lost and nothing was reversed", () => {
    expect(
      featureDocumentWentBack({
        ownershipLost: true,
        unreversed: ["feature document", "ramp schedules"],
      }),
    ).toBe(false);
  });
});
