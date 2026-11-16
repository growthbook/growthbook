import { InterleavingInterface } from "shared/validators";
import { getInterleavingPayloadKeys } from "back-end/src/util/interleavings";

const interleaving = (fields: Partial<InterleavingInterface>) =>
  ({ environmentSettings: {}, ...fields }) as InterleavingInterface;

describe("getInterleavingPayloadKeys", () => {
  it("keys every enabled org environment by the interleaving's project", () => {
    expect(
      getInterleavingPayloadKeys(
        [
          interleaving({
            project: "p1",
            environmentSettings: {
              production: { enabled: true },
              dev: { enabled: false },
              removed: { enabled: true },
            },
          }),
          interleaving({ environmentSettings: { dev: { enabled: true } } }),
        ],
        ["production", "dev"],
      ),
    ).toEqual([
      { environment: "production", project: "p1" },
      { environment: "production", project: "" },
      { environment: "dev", project: "p1" },
      { environment: "dev", project: "" },
    ]);
  });

  it("returns nothing when no environment is enabled", () => {
    expect(
      getInterleavingPayloadKeys([interleaving({ project: "p1" })], ["dev"]),
    ).toEqual([]);
  });
});
