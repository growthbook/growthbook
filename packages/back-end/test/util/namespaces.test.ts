import {
  experimentAllocatesTrafficInNamespace,
  NamespaceUsageExperiment,
} from "back-end/src/util/namespaces";

// A running, feature-linked experiment whose latest phase is in `ns_checkout`.
function experiment(
  overrides: Partial<NamespaceUsageExperiment> = {},
): NamespaceUsageExperiment {
  return {
    status: "running",
    linkedFeatures: ["feature_1"],
    releasedVariationId: "",
    phases: [
      { namespace: { enabled: true, name: "ns_checkout", range: [0, 0.5] } },
    ],
    ...overrides,
  };
}

describe("experimentAllocatesTrafficInNamespace", () => {
  it("counts a running experiment whose latest phase is in the namespace", () => {
    expect(
      experimentAllocatesTrafficInNamespace(experiment(), "ns_checkout"),
    ).toBe(true);
  });

  it("ignores a different namespace", () => {
    expect(
      experimentAllocatesTrafficInNamespace(experiment(), "ns_signup"),
    ).toBe(false);
  });

  it("ignores a namespace that is not enabled on the phase", () => {
    const exp = experiment({
      phases: [
        { namespace: { enabled: false, name: "ns_checkout", range: [0, 0.5] } },
      ],
    });
    expect(experimentAllocatesTrafficInNamespace(exp, "ns_checkout")).toBe(
      false,
    );
  });

  it("only looks at the latest phase", () => {
    const exp = experiment({
      phases: [
        { namespace: { enabled: true, name: "ns_checkout", range: [0, 0.5] } },
        { namespace: { enabled: true, name: "ns_signup", range: [0, 0.5] } },
      ],
    });
    expect(experimentAllocatesTrafficInNamespace(exp, "ns_checkout")).toBe(
      false,
    );
    expect(experimentAllocatesTrafficInNamespace(exp, "ns_signup")).toBe(true);
  });

  it("ignores an experiment with no phases", () => {
    expect(
      experimentAllocatesTrafficInNamespace(
        experiment({ phases: [] }),
        "ns_checkout",
      ),
    ).toBe(false);
    expect(
      experimentAllocatesTrafficInNamespace(
        experiment({ phases: undefined }),
        "ns_checkout",
      ),
    ).toBe(false);
  });

  it("ignores archived experiments", () => {
    expect(
      experimentAllocatesTrafficInNamespace(
        experiment({ archived: true }),
        "ns_checkout",
      ),
    ).toBe(false);
  });

  it("ignores experiments with no linked changes", () => {
    expect(
      experimentAllocatesTrafficInNamespace(
        experiment({ linkedFeatures: [] }),
        "ns_checkout",
      ),
    ).toBe(false);
  });

  it("counts experiments linked by visual changesets or URL redirects", () => {
    expect(
      experimentAllocatesTrafficInNamespace(
        experiment({ linkedFeatures: [], hasVisualChangesets: true }),
        "ns_checkout",
      ),
    ).toBe(true);
    expect(
      experimentAllocatesTrafficInNamespace(
        experiment({ linkedFeatures: [], hasURLRedirects: true }),
        "ns_checkout",
      ),
    ).toBe(true);
  });

  describe("stopped experiments", () => {
    it("counts one that is still rolling out a winner", () => {
      const exp = experiment({
        status: "stopped",
        releasedVariationId: "var_1",
      });
      expect(experimentAllocatesTrafficInNamespace(exp, "ns_checkout")).toBe(
        true,
      );
    });

    it("ignores one with no released variation", () => {
      const exp = experiment({ status: "stopped", releasedVariationId: "" });
      expect(experimentAllocatesTrafficInNamespace(exp, "ns_checkout")).toBe(
        false,
      );
    });

    it("ignores one explicitly excluded from the payload", () => {
      const exp = experiment({
        status: "stopped",
        releasedVariationId: "var_1",
        excludeFromPayload: true,
      });
      expect(experimentAllocatesTrafficInNamespace(exp, "ns_checkout")).toBe(
        false,
      );
    });
  });

  // `releasedVariationId` is derived by `upgradeExperimentDoc`, so a legacy doc
  // read without that migration has no such field. These experiments ARE in the
  // SDK payload once migrated, so the guards must see them.
  describe("legacy docs predating the releasedVariationId migration", () => {
    const legacy = (
      overrides: Partial<NamespaceUsageExperiment>,
    ): NamespaceUsageExperiment => {
      const exp = experiment({ status: "stopped", ...overrides });
      delete exp.releasedVariationId;
      return exp;
    };

    it("counts a stopped winner", () => {
      const exp = legacy({
        results: "won",
        winner: 1,
        variations: [{ id: "var_0" }, { id: "var_1" }],
      });
      expect(experimentAllocatesTrafficInNamespace(exp, "ns_checkout")).toBe(
        true,
      );
    });

    it("counts a stopped winner whose variations have no stored ids", () => {
      const exp = legacy({
        results: "won",
        winner: 1,
        variations: [{}, {}],
      });
      expect(experimentAllocatesTrafficInNamespace(exp, "ns_checkout")).toBe(
        true,
      );
    });

    it("defaults a stopped winner with no recorded winner index to variation 1", () => {
      const exp = legacy({
        results: "won",
        variations: [{ id: "var_0" }, { id: "var_1" }],
      });
      expect(experimentAllocatesTrafficInNamespace(exp, "ns_checkout")).toBe(
        true,
      );
    });

    it("counts a stopped loser, which rolls the control back out", () => {
      const exp = legacy({
        results: "lost",
        variations: [{ id: "var_0" }, { id: "var_1" }],
      });
      expect(experimentAllocatesTrafficInNamespace(exp, "ns_checkout")).toBe(
        true,
      );
    });

    it("ignores an inconclusive or unrecorded result", () => {
      expect(
        experimentAllocatesTrafficInNamespace(
          legacy({ results: "inconclusive" }),
          "ns_checkout",
        ),
      ).toBe(false);
      expect(
        experimentAllocatesTrafficInNamespace(legacy({}), "ns_checkout"),
      ).toBe(false);
    });

    it("ignores a winner index pointing past the variation list", () => {
      const exp = legacy({
        results: "won",
        winner: 5,
        variations: [{ id: "var_0" }, { id: "var_1" }],
      });
      expect(experimentAllocatesTrafficInNamespace(exp, "ns_checkout")).toBe(
        false,
      );
    });

    it("still counts a running experiment, which needs no released variation", () => {
      const exp = legacy({ status: "running" });
      expect(experimentAllocatesTrafficInNamespace(exp, "ns_checkout")).toBe(
        true,
      );
    });
  });
});
