import { assertValidReleasedVariationId } from "back-end/src/util/releasedVariationId.util";

const variation = (id: string) => ({
  id,
  key: id,
  name: id,
  screenshots: [],
});

const stored = {
  releasedVariationId: "var_b",
  variations: [variation("var_a"), variation("var_b")],
};

const stale = {
  releasedVariationId: "var_gone",
  variations: [variation("var_a"), variation("var_b")],
};

describe("assertValidReleasedVariationId", () => {
  describe("on create (no existing experiment)", () => {
    it("accepts a released id that is one of the variations", () => {
      expect(() => assertValidReleasedVariationId(stored)).not.toThrow();
    });

    it("accepts an empty or missing released id", () => {
      expect(() =>
        assertValidReleasedVariationId({ ...stored, releasedVariationId: "" }),
      ).not.toThrow();
      expect(() =>
        assertValidReleasedVariationId({ variations: stored.variations }),
      ).not.toThrow();
    });

    it("rejects a released id that is not one of the variations", () => {
      expect(() =>
        assertValidReleasedVariationId({
          ...stored,
          releasedVariationId: "var_nope",
        }),
      ).toThrow(/invalid_released_variation_id/);
    });

    it("rejects a released id when there are no variations", () => {
      expect(() =>
        assertValidReleasedVariationId({ releasedVariationId: "var_a" }),
      ).toThrow(/invalid_released_variation_id/);
    });
  });

  describe("on update", () => {
    it("accepts changing the released id to another variation", () => {
      expect(() =>
        assertValidReleasedVariationId(
          { ...stored, releasedVariationId: "var_a" },
          stored,
        ),
      ).not.toThrow();
    });

    it("rejects changing the released id to a non-variation", () => {
      expect(() =>
        assertValidReleasedVariationId(
          { ...stored, releasedVariationId: "var_nope" },
          stored,
        ),
      ).toThrow(/invalid_released_variation_id/);
    });

    it("checks a new released id against variations sent in the same write", () => {
      expect(() =>
        assertValidReleasedVariationId(
          {
            releasedVariationId: "var_d",
            variations: [variation("var_c"), variation("var_d")],
          },
          { ...stored, releasedVariationId: "" },
        ),
      ).not.toThrow();
    });

    it("rejects replacing the variations out from under a valid released id", () => {
      expect(() =>
        assertValidReleasedVariationId(
          {
            ...stored,
            variations: [variation("var_c"), variation("var_d")],
          },
          stored,
        ),
      ).toThrow(/invalid_released_variation_id/);
    });

    it("rejects removing just the released variation", () => {
      expect(() =>
        assertValidReleasedVariationId(
          { ...stored, variations: [variation("var_a")] },
          stored,
        ),
      ).toThrow(/invalid_released_variation_id/);
    });

    it("accepts reordering or adding variations while the released id stays valid", () => {
      expect(() =>
        assertValidReleasedVariationId(
          {
            ...stored,
            variations: [
              variation("var_b"),
              variation("var_a"),
              variation("var_c"),
            ],
          },
          stored,
        ),
      ).not.toThrow();
    });

    it("accepts clearing the released id", () => {
      expect(() =>
        assertValidReleasedVariationId(
          { ...stored, releasedVariationId: "" },
          stored,
        ),
      ).not.toThrow();
    });

    describe("when the stored released id is already stale", () => {
      it("accepts an unrelated edit that echoes the stale id", () => {
        expect(() =>
          assertValidReleasedVariationId(stale, stale),
        ).not.toThrow();
      });

      it("accepts adding a variation", () => {
        expect(() =>
          assertValidReleasedVariationId(
            { ...stale, variations: [...stale.variations, variation("var_c")] },
            stale,
          ),
        ).not.toThrow();
      });

      it("accepts removing some other variation", () => {
        expect(() =>
          assertValidReleasedVariationId(
            { ...stale, variations: [variation("var_a")] },
            stale,
          ),
        ).not.toThrow();
      });

      it("accepts replacing every variation", () => {
        expect(() =>
          assertValidReleasedVariationId(
            { ...stale, variations: [variation("var_c")] },
            stale,
          ),
        ).not.toThrow();
      });

      it("still rejects changing the released id to another non-variation", () => {
        expect(() =>
          assertValidReleasedVariationId(
            { ...stale, releasedVariationId: "var_also_gone" },
            stale,
          ),
        ).toThrow(/invalid_released_variation_id/);
      });

      it("accepts fixing the released id to a real variation", () => {
        expect(() =>
          assertValidReleasedVariationId(
            { ...stale, releasedVariationId: "var_a" },
            stale,
          ),
        ).not.toThrow();
      });
    });
  });
});
