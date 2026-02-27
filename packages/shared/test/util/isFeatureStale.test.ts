import { subWeeks } from "date-fns";
import cloneDeep from "lodash/cloneDeep";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FeatureInterface, ExperimentRefRule } from "shared/types/feature";

import { isFeatureStale } from "../../src/util";

const genMockExperiment = ({
  id,
  status,
  ...rest
}: Partial<ExperimentInterfaceStringDates>): ExperimentInterfaceStringDates => ({
  id: id || "exp_123",
  status: status || "running",
  trackingKey: "",
  organization: "123",
  owner: "adnan",
  datasource: "",
  exposureQueryId: "",
  implementation: "code",
  hashAttribute: "id",
  hashVersion: 2,
  name: "test",
  dateCreated: new Date().toISOString(),
  dateUpdated: new Date().toISOString(),
  tags: [],
  metrics: [],
  autoAssign: false,
  previewURL: "",
  targetURLRegex: "",
  phases: [
    {
      coverage: 1,
      dateStarted: "2023-08-05T05:27:00Z",
      variationWeights: [0.5, 0.5],
      namespace: { enabled: false, name: "", range: [0, 1] },
      condition: '{"country": "123"}',
      name: "Main",
      reason: "",
      seed: "viusal-07",
    },
  ],
  releasedVariationId: "",
  autoSnapshots: false,
  variations: [],
  archived: false,
  hasVisualChangesets: true,
  ...rest,
});

const genExperimentRef = ({
  experimentId,
  variations,
  enabled,
}: Partial<ExperimentRefRule>): ExperimentRefRule => ({
  type: "experiment-ref",
  id: "fr_1xx71iycloeon68r",
  experimentId: experimentId || "exp_1xx71iycloeomlw6",
  description: "",
  variations: variations || [
    {
      variationId: "var_loeomlv8",
      value: "false",
    },
    {
      variationId: "var_loeomlv9",
      value: "true",
    },
  ],
  enabled: enabled != null ? enabled : true,
});

describe("isFeatureStale", () => {
  let feature: FeatureInterface;

  beforeEach(() => {
    feature = {
      hasDrafts: false,
      version: 1,
      dateCreated: new Date("2020-04-20"),
      dateUpdated: new Date("2020-04-20"),
      defaultValue: "true",
      environmentSettings: {
        dev: {
          enabled: true,
          rules: [
            {
              description: "test",
              type: "force",
              id: "123",
              value: "123",
            },
          ],
        },
        production: { enabled: true, rules: [] },
      },
      id: "feature-123",
      organization: "123",
      owner: "adnan",
      valueType: "boolean",
      linkedExperiments: [],
    };
  });

  describe("if the feature has a draft revision", () => {
    beforeEach(() => {
      feature.hasDrafts = true;
    });
    it("is not stale", () => {
      expect(isFeatureStale({ feature })).toMatchObject({ stale: false });
    });
  });

  describe("when all environments are disabled", () => {
    beforeEach(() => {
      feature.environmentSettings = {
        development: { enabled: false, rules: [] },
        staging: {
          enabled: false,
          rules: [
            {
              description: "test",
              type: "force",
              id: "123",
              value: "123",
            },
          ],
        },

        production: { enabled: false, rules: [] },
      };
    });
    describe("and has been updated within past two weeks", () => {
      it("is not stale", () => {
        feature.dateUpdated = subWeeks(new Date(), 1);
        expect(isFeatureStale({ feature })).toMatchObject({ stale: false });
      });
    });
    describe("and has not been updated within past two weeks", () => {
      it("is stale", () => {
        feature.dateUpdated = subWeeks(new Date(), 3);
        expect(isFeatureStale({ feature })).toMatchObject({
          stale: true,
          reason: "toggled-off",
        });
      });
    });
    describe("when the feature has been marked as neverStale", () => {
      beforeEach(() => {
        feature.neverStale = true;
      });
      describe("and has been updated within past two weeks", () => {
        it("is not stale", () => {
          feature.dateUpdated = subWeeks(new Date(), 1);
          expect(isFeatureStale({ feature })).toMatchObject({
            stale: false,
            reason: "never-stale",
          });
        });
      });
      describe("and has not been updated within past two weeks", () => {
        it("is not stale", () => {
          feature.dateUpdated = subWeeks(new Date(), 3);
          expect(isFeatureStale({ feature })).toMatchObject({
            stale: false,
            reason: "never-stale",
          });
        });
      });
    });
  });

  describe("when feature has no rules", () => {
    beforeEach(() => {
      feature.environmentSettings = {
        development: { enabled: true, rules: [] },
        staging: { enabled: true, rules: [] },
        production: { enabled: false, rules: [] },
      };
    });
    describe("and has been updated within past two weeks", () => {
      it("is not stale", () => {
        feature.dateUpdated = subWeeks(new Date(), 1);
        expect(isFeatureStale({ feature })).toMatchObject({ stale: false });
      });
    });
    describe("and has not been updated within past two weeks", () => {
      it("is stale", () => {
        feature.dateUpdated = subWeeks(new Date(), 3);
        expect(isFeatureStale({ feature })).toMatchObject({
          stale: true,
          reason: "no-rules",
        });
      });
    });
  });

  describe("when feature has rules", () => {
    describe("if every environment contains only rollout rules (or no rules at all)", () => {
      describe("and some have <100% coverage or targeting conditions", () => {
        beforeEach(() => {
          feature.environmentSettings = {
            development: {
              enabled: true,
              rules: [
                {
                  condition: '{"id": "15"}',
                  coverage: 1,
                  enabled: true,
                  hashAttribute: "id",
                  value: "2",
                  description: "",
                  id: "fr_1xx71305loywqomm",
                  type: "rollout",
                },
              ],
            },
            staging: {
              enabled: true,
              rules: [
                {
                  coverage: 0.8,
                  enabled: true,
                  hashAttribute: "id",
                  value: "2",
                  description: "",
                  id: "fr_1xx71305loywqomm",
                  type: "rollout",
                },
              ],
            },
            production: {
              enabled: false,
              rules: [],
            },
          };
        });
        describe("and has been updated within past two weeks", () => {
          it("is not stale", () => {
            feature.dateUpdated = subWeeks(new Date(), 1);
            expect(isFeatureStale({ feature })).toMatchObject({ stale: false });
          });
        });
        describe("and has not been updated within past two weeks", () => {
          it("is not stale", () => {
            feature.dateUpdated = subWeeks(new Date(), 3);
            expect(isFeatureStale({ feature })).toMatchObject({ stale: false });
          });
        });
      });
      describe("and at least one has a saved group", () => {
        beforeEach(() => {
          feature.environmentSettings = {
            development: {
              enabled: true,
              rules: [
                {
                  savedGroups: [
                    {
                      ids: ["123"],
                      match: "all",
                    },
                  ],
                  coverage: 1,
                  enabled: true,
                  hashAttribute: "id",
                  value: "2",
                  description: "",
                  id: "fr_1xx71305loywqomm",
                  type: "rollout",
                },
              ],
            },
            staging: {
              enabled: true,
              rules: [],
            },
            production: {
              enabled: false,
              rules: [],
            },
          };
        });
        describe("and has been updated within past two weeks", () => {
          it("is not stale", () => {
            feature.dateUpdated = subWeeks(new Date(), 1);
            expect(isFeatureStale({ feature })).toMatchObject({ stale: false });
          });
        });
        describe("and has not been updated within past two weeks", () => {
          it("is not stale", () => {
            feature.dateUpdated = subWeeks(new Date(), 3);
            expect(isFeatureStale({ feature })).toMatchObject({ stale: false });
          });
        });
      });
      describe("and all have coverage of 100% with no targeting conditions", () => {
        beforeEach(() => {
          feature.environmentSettings = {
            development: {
              enabled: true,
              rules: [
                {
                  coverage: 1,
                  enabled: true,
                  hashAttribute: "id",
                  value: "2",
                  description: "",
                  id: "fr_1xx71305loywqomm",
                  type: "rollout",
                },
              ],
            },
            staging: {
              enabled: true,
              rules: [
                {
                  coverage: 1,
                  enabled: true,
                  hashAttribute: "id",
                  value: "2",
                  description: "",
                  id: "fr_1xx71305loywqomm",
                  type: "rollout",
                },
              ],
            },
            production: {
              enabled: false,
              rules: [],
            },
          };
        });
        describe("and has been updated within past two weeks", () => {
          it("is not stale", () => {
            feature.dateUpdated = subWeeks(new Date(), 1);
            expect(isFeatureStale({ feature })).toMatchObject({ stale: false });
          });
        });
        describe("and has not been updated within past two weeks", () => {
          it("is stale", () => {
            feature.dateUpdated = subWeeks(new Date(), 3);
            expect(isFeatureStale({ feature })).toMatchObject({
              stale: true,
              reason: "rules-one-sided",
            });
          });
        });
      });
    });

    describe("if every environment contains only force rules (or no rules at all)", () => {
      describe("and some have targeting conditions", () => {
        beforeEach(() => {
          feature.environmentSettings = {
            development: {
              enabled: true,
              rules: [
                {
                  condition: '{"id": "123"}',
                  id: "fr_1xx71305loyw36tv",
                  enabled: true,
                  value: "45",
                  description: "",
                  savedGroups: [],
                  type: "force",
                },
              ],
            },
            staging: {
              enabled: true,
              rules: [],
            },
            production: {
              enabled: true,
              rules: [
                {
                  id: "fr_1xx71305loyw36tv",
                  enabled: true,
                  value: "45",
                  description: "",
                  savedGroups: [],
                  type: "force",
                },
              ],
            },
          };
        });
        describe("and has been updated within past two weeks", () => {
          it("is not stale", () => {
            feature.dateUpdated = subWeeks(new Date(), 1);
            expect(isFeatureStale({ feature })).toMatchObject({ stale: false });
          });
        });
        describe("and has not been updated within past two weeks", () => {
          it("is not stale", () => {
            feature.dateUpdated = subWeeks(new Date(), 3);
            expect(isFeatureStale({ feature })).toMatchObject({ stale: false });
          });
        });
      });
      describe("and at least one has a saved group", () => {
        beforeEach(() => {
          feature.environmentSettings = {
            development: {
              enabled: true,
              rules: [
                {
                  id: "fr_1xx71305loyw36tv",
                  enabled: true,
                  value: "45",
                  description: "",
                  savedGroups: [
                    {
                      ids: ["123"],
                      match: "any",
                    },
                  ],
                  type: "force",
                },
              ],
            },
            staging: {
              enabled: true,
              rules: [],
            },
            production: {
              enabled: true,
              rules: [
                {
                  id: "fr_1xx71305loyw36tv",
                  enabled: true,
                  value: "45",
                  description: "",
                  savedGroups: [],
                  type: "force",
                },
              ],
            },
          };
        });
        describe("and has been updated within past two weeks", () => {
          it("is not stale", () => {
            feature.dateUpdated = subWeeks(new Date(), 1);
            expect(isFeatureStale({ feature })).toMatchObject({ stale: false });
          });
        });
        describe("and has not been updated within past two weeks", () => {
          it("is not stale", () => {
            feature.dateUpdated = subWeeks(new Date(), 3);
            expect(isFeatureStale({ feature })).toMatchObject({ stale: false });
          });
        });
      });
      describe("and none have targeting conditions", () => {
        beforeEach(() => {
          feature.environmentSettings = {
            development: {
              enabled: true,
              rules: [],
            },
            staging: {
              enabled: true,
              rules: [
                {
                  id: "fr_1xx71305loyw36tv",
                  enabled: true,
                  value: "45",
                  description: "",
                  savedGroups: [],
                  type: "force",
                },
              ],
            },
            production: {
              enabled: false,
              rules: [
                {
                  id: "fr_1xx71305loyw36tv",
                  enabled: true,
                  value: "45",
                  description: "",
                  savedGroups: [],
                  type: "force",
                },
              ],
            },
          };
        });
        describe("and has been updated within past two weeks", () => {
          it("is not stale", () => {
            feature.dateUpdated = subWeeks(new Date(), 1);
            expect(isFeatureStale({ feature })).toMatchObject({ stale: false });
          });
        });
        describe("and has not been updated within past two weeks", () => {
          it("is stale", () => {
            feature.dateUpdated = subWeeks(new Date(), 3);
            // dev has no rules ("no-rules"), staging has one-sided rule; no-rules takes priority
            expect(isFeatureStale({ feature })).toMatchObject({
              stale: true,
              reason: "no-rules",
            });
          });
        });
      });
    });

    describe("if every environment contains a mix of rules (or no rules at all)", () => {
      let experiments: ExperimentInterfaceStringDates[];
      describe("and all rollout rules have 100% coverage and no targeting conditions", () => {
        describe("and all force rules have no targeting conditions", () => {
          describe("and there are no experiment rules", () => {
            beforeEach(() => {
              feature.environmentSettings = {
                development: {
                  enabled: true,
                  rules: [
                    {
                      coverage: 1,
                      enabled: true,
                      hashAttribute: "id",
                      value: "2",
                      description: "",
                      id: "fr_1xx71305loywqomm",
                      type: "rollout",
                    },
                  ],
                },
                staging: {
                  enabled: true,
                  rules: [],
                },
                production: {
                  enabled: true,
                  rules: [
                    {
                      id: "fr_1xx71305loyw36tv",
                      enabled: true,
                      value: "45",
                      description: "",
                      savedGroups: [],
                      type: "force",
                    },
                    {
                      coverage: 1,
                      enabled: true,
                      hashAttribute: "id",
                      value: "45",
                      description: "",
                      id: "fr_2xx71305loywqomm",
                      type: "rollout",
                    },
                  ],
                },
              };
            });
            describe("and has been updated within past two weeks", () => {
              it("is not stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 1);
                expect(isFeatureStale({ feature })).toMatchObject({
                  stale: false,
                });
              });
            });
            describe("and has not been updated within past two weeks", () => {
              it("is stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 3);
                // staging has no rules → "no-rules" takes priority over "rules-one-sided"
                expect(isFeatureStale({ feature })).toMatchObject({
                  stale: true,
                  reason: "no-rules",
                });
              });
            });
          });
          describe("and there are experiment rules but experiments are inactive", () => {
            beforeEach(() => {
              experiments = [
                genMockExperiment({ id: "exp_1", status: "draft", phases: [] }),
              ];
              feature.linkedExperiments = experiments.map((e) => e.id);
              feature.environmentSettings = {
                development: {
                  enabled: true,
                  rules: [
                    {
                      coverage: 1,
                      enabled: true,
                      hashAttribute: "id",
                      value: "2",
                      description: "",
                      id: "fr_1xx71305loywqomm",
                      type: "rollout",
                    },
                  ],
                },
                staging: {
                  enabled: true,
                  rules: [
                    {
                      type: "experiment-ref",
                      enabled: true,
                      description: "",
                      experimentId: experiments[0].id,
                      id: "fr_1xx71305loywztkc",
                      variations: [
                        {
                          variationId: "var_lmayh582",
                          value: "1",
                        },
                        {
                          variationId: "var_lmayh583",
                          value: "0",
                        },
                      ],
                    },
                  ],
                },
                production: {
                  enabled: false,
                  rules: [
                    {
                      id: "fr_1xx71305loyw36tv",
                      enabled: true,
                      value: "45",
                      description: "",
                      savedGroups: [],
                      type: "force",
                    },
                    {
                      coverage: 1,
                      enabled: true,
                      hashAttribute: "id",
                      value: "45",
                      description: "",
                      id: "fr_2xx71305loywqomm",
                      type: "rollout",
                    },
                  ],
                },
              };
            });
            describe("and has been updated within past two weeks", () => {
              it("is not stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 1);
                expect(isFeatureStale({ feature, experiments })).toMatchObject({
                  stale: false,
                });
              });
            });
            describe("and has not been updated within past two weeks", () => {
              it("is stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 3);
                expect(isFeatureStale({ feature, experiments })).toMatchObject({
                  stale: true,
                  reason: "rules-one-sided",
                });
              });
            });
          });
          describe("and there are active experiment rules", () => {
            beforeEach(() => {
              experiments = [
                genMockExperiment({ id: "exp_1", status: "running" }),
              ];
              feature.linkedExperiments = experiments.map((e) => e.id);
              feature.environmentSettings = {
                development: {
                  enabled: true,
                  rules: [
                    {
                      coverage: 1,
                      enabled: true,
                      hashAttribute: "id",
                      value: "2",
                      description: "",
                      id: "fr_1xx71305loywqomm",
                      type: "rollout",
                    },
                  ],
                },
                staging: {
                  enabled: true,
                  rules: [
                    {
                      type: "experiment-ref",
                      enabled: true,
                      description: "",
                      experimentId: experiments[0].id,
                      id: "fr_1xx71305loywztkc",
                      variations: [
                        {
                          variationId: "var_lmayh582",
                          value: "1",
                        },
                        {
                          variationId: "var_lmayh583",
                          value: "0",
                        },
                      ],
                    },
                  ],
                },
                production: {
                  enabled: false,
                  rules: [
                    {
                      id: "fr_1xx71305loyw36tv",
                      enabled: true,
                      value: "45",
                      description: "",
                      savedGroups: [],
                      type: "force",
                    },
                    {
                      coverage: 1,
                      enabled: true,
                      hashAttribute: "id",
                      value: "45",
                      description: "",
                      id: "fr_2xx71305loywqomm",
                      type: "rollout",
                    },
                  ],
                },
              };
            });
            describe("and has been updated within past two weeks", () => {
              it("is not stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 1);
                expect(isFeatureStale({ feature, experiments })).toMatchObject({
                  stale: false,
                });
              });
            });
            describe("and has not been updated within past two weeks", () => {
              it("is not stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 3);
                expect(isFeatureStale({ feature, experiments })).toMatchObject({
                  stale: false,
                });
              });
            });
          });
        });
        describe("and some force rules have targeting conditions", () => {
          describe("and there are no experiment rules", () => {
            beforeEach(() => {
              feature.environmentSettings = {
                development: {
                  enabled: true,
                  rules: [
                    {
                      id: "fr_1xx71305loyw36tv",
                      enabled: true,
                      value: "45",
                      description: "",
                      savedGroups: [],
                      type: "force",
                    },
                  ],
                },
                staging: {
                  enabled: true,
                  rules: [],
                },
                production: {
                  enabled: true,
                  rules: [
                    {
                      condition: '{"id": "15"}',
                      id: "fr_1xx71305loyw36tv",
                      enabled: true,
                      value: "45",
                      description: "",
                      savedGroups: [],
                      type: "force",
                    },
                    {
                      coverage: 0.8,
                      enabled: true,
                      hashAttribute: "id",
                      value: "45",
                      description: "",
                      id: "fr_2xx71305loywqomm",
                      type: "rollout",
                    },
                  ],
                },
              };
            });
            describe("and has been updated within past two weeks", () => {
              it("is not stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 1);
                expect(isFeatureStale({ feature })).toMatchObject({
                  stale: false,
                });
              });
            });
            describe("and has not been updated within past two weeks", () => {
              it("is not stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 3);
                expect(isFeatureStale({ feature })).toMatchObject({
                  stale: false,
                });
              });
            });
          });
          describe("and there are experiment rules but experiments are inactive", () => {
            beforeEach(() => {
              experiments = [
                genMockExperiment({ id: "exp_1", status: "draft" }),
              ];
              feature.linkedExperiments = experiments.map((e) => e.id);
              feature.environmentSettings = {
                development: {
                  enabled: true,
                  rules: [
                    {
                      id: "fr_1xx71305loyw36tv",
                      enabled: true,
                      value: "45",
                      description: "",
                      savedGroups: [],
                      type: "force",
                    },
                  ],
                },
                staging: {
                  enabled: true,
                  rules: [
                    {
                      type: "experiment-ref",
                      enabled: true,
                      description: "",
                      experimentId: experiments[0].id,
                      id: "fr_1xx71305loywztkc",
                      variations: [
                        {
                          variationId: "var_lmayh582",
                          value: "1",
                        },
                        {
                          variationId: "var_lmayh583",
                          value: "0",
                        },
                      ],
                    },
                  ],
                },
                production: {
                  enabled: true,
                  rules: [
                    {
                      condition: '{"id": "15"}',
                      id: "fr_1xx71305loyw36tv",
                      enabled: true,
                      value: "45",
                      description: "",
                      savedGroups: [],
                      type: "force",
                    },
                    {
                      coverage: 0.8,
                      enabled: true,
                      hashAttribute: "id",
                      value: "45",
                      description: "",
                      id: "fr_2xx71305loywqomm",
                      type: "rollout",
                    },
                  ],
                },
              };
            });
            describe("and has been updated within past two weeks", () => {
              it("is not stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 1);
                expect(isFeatureStale({ feature, experiments })).toMatchObject({
                  stale: false,
                });
              });
            });
            describe("and has not been updated within past two weeks", () => {
              it("is not stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 3);
                expect(isFeatureStale({ feature, experiments })).toMatchObject({
                  stale: false,
                });
              });
            });
          });
          describe("and there are active experiment rules", () => {
            beforeEach(() => {
              experiments = [
                genMockExperiment({ id: "exp_1", status: "running" }),
              ];
              feature.linkedExperiments = experiments.map((e) => e.id);
              feature.environmentSettings = {
                development: {
                  enabled: true,
                  rules: [
                    {
                      id: "fr_1xx71305loyw36tv",
                      enabled: true,
                      value: "45",
                      description: "",
                      savedGroups: [],
                      type: "force",
                    },
                  ],
                },
                staging: {
                  enabled: true,
                  rules: [
                    {
                      type: "experiment-ref",
                      enabled: true,
                      description: "",
                      experimentId: experiments[0].id,
                      id: "fr_1xx71305loywztkc",
                      variations: [
                        {
                          variationId: "var_lmayh582",
                          value: "1",
                        },
                        {
                          variationId: "var_lmayh583",
                          value: "0",
                        },
                      ],
                    },
                  ],
                },
                production: {
                  enabled: true,
                  rules: [
                    {
                      condition: '{"id": "15"}',
                      id: "fr_1xx71305loyw36tv",
                      enabled: true,
                      value: "45",
                      description: "",
                      savedGroups: [],
                      type: "force",
                    },
                    {
                      coverage: 0.8,
                      enabled: true,
                      hashAttribute: "id",
                      value: "45",
                      description: "",
                      id: "fr_2xx71305loywqomm",
                      type: "rollout",
                    },
                  ],
                },
              };
            });
            describe("and has been updated within past two weeks", () => {
              it("is not stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 1);
                expect(isFeatureStale({ feature, experiments })).toMatchObject({
                  stale: false,
                });
              });
            });
            describe("and has not been updated within past two weeks", () => {
              it("is not stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 3);
                expect(isFeatureStale({ feature, experiments })).toMatchObject({
                  stale: false,
                });
              });
            });
          });
        });
      });
      describe("and only some rollout rules have 100% coverage", () => {
        describe("and all force rules have no targeting conditions", () => {
          describe("and there are no experiment rules", () => {
            beforeEach(() => {
              feature.environmentSettings = {
                development: {
                  enabled: true,
                  rules: [
                    {
                      coverage: 0.8,
                      enabled: true,
                      hashAttribute: "id",
                      value: "45",
                      description: "",
                      id: "fr_2xx71305loywqomm",
                      type: "rollout",
                    },
                  ],
                },
                staging: {
                  enabled: true,
                  rules: [],
                },
                production: {
                  enabled: true,
                  rules: [
                    {
                      id: "fr_1xx71305loyw36tv",
                      enabled: true,
                      value: "45",
                      description: "",
                      savedGroups: [],
                      type: "force",
                    },
                    {
                      coverage: 1,
                      enabled: true,
                      hashAttribute: "id",
                      value: "2",
                      description: "",
                      id: "fr_1xx71305loywqomm",
                      type: "rollout",
                    },
                  ],
                },
              };
            });
            describe("and has been updated within past two weeks", () => {
              it("is not stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 1);
                expect(isFeatureStale({ feature })).toMatchObject({
                  stale: false,
                });
              });
            });
            describe("and has not been updated within past two weeks", () => {
              it("is not stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 3);
                expect(isFeatureStale({ feature })).toMatchObject({
                  stale: false,
                });
              });
            });
          });
          describe("and there are experiment rules but they are inactive", () => {
            beforeEach(() => {
              experiments = [
                genMockExperiment({ id: "exp_1", status: "draft" }),
              ];
              feature.linkedExperiments = experiments.map((e) => e.id);
              feature.environmentSettings = {
                development: {
                  enabled: true,
                  rules: [
                    {
                      coverage: 0.8,
                      enabled: true,
                      hashAttribute: "id",
                      value: "45",
                      description: "",
                      id: "fr_2xx71305loywqomm",
                      type: "rollout",
                    },
                  ],
                },
                staging: {
                  enabled: true,
                  rules: [
                    {
                      type: "experiment-ref",
                      enabled: true,
                      description: "",
                      experimentId: experiments[0].id,
                      id: "fr_1xx71305loywztkc",
                      variations: [
                        {
                          variationId: "var_lmayh582",
                          value: "1",
                        },
                        {
                          variationId: "var_lmayh583",
                          value: "0",
                        },
                      ],
                    },
                  ],
                },
                production: {
                  enabled: true,
                  rules: [
                    {
                      id: "fr_1xx71305loyw36tv",
                      enabled: true,
                      value: "45",
                      description: "",
                      savedGroups: [],
                      type: "force",
                    },
                    {
                      coverage: 1,
                      enabled: true,
                      hashAttribute: "id",
                      value: "2",
                      description: "",
                      id: "fr_1xx71305loywqomm",
                      type: "rollout",
                    },
                  ],
                },
              };
            });
            describe("and has been updated within past two weeks", () => {
              it("is not stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 1);
                expect(isFeatureStale({ feature, experiments })).toMatchObject({
                  stale: false,
                });
              });
            });
            describe("and has not been updated within past two weeks", () => {
              it("is not stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 3);
                expect(isFeatureStale({ feature, experiments })).toMatchObject({
                  stale: false,
                });
              });
            });
          });
          describe("and there are active experiment rules", () => {
            beforeEach(() => {
              experiments = [
                genMockExperiment({ id: "exp_1", status: "running" }),
              ];
              feature.linkedExperiments = experiments.map((e) => e.id);
              feature.environmentSettings = {
                development: {
                  enabled: true,
                  rules: [
                    {
                      coverage: 0.8,
                      enabled: true,
                      hashAttribute: "id",
                      value: "45",
                      description: "",
                      id: "fr_2xx71305loywqomm",
                      type: "rollout",
                    },
                  ],
                },
                staging: {
                  enabled: true,
                  rules: [
                    {
                      type: "experiment-ref",
                      enabled: true,
                      description: "",
                      experimentId: experiments[0].id,
                      id: "fr_1xx71305loywztkc",
                      variations: [
                        {
                          variationId: "var_lmayh582",
                          value: "1",
                        },
                        {
                          variationId: "var_lmayh583",
                          value: "0",
                        },
                      ],
                    },
                  ],
                },
                production: {
                  enabled: true,
                  rules: [
                    {
                      id: "fr_1xx71305loyw36tv",
                      enabled: true,
                      value: "45",
                      description: "",
                      savedGroups: [],
                      type: "force",
                    },
                    {
                      coverage: 1,
                      enabled: true,
                      hashAttribute: "id",
                      value: "2",
                      description: "",
                      id: "fr_1xx71305loywqomm",
                      type: "rollout",
                    },
                  ],
                },
              };
            });
            describe("and has been updated within past two weeks", () => {
              it("is not stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 1);
                expect(isFeatureStale({ feature, experiments })).toMatchObject({
                  stale: false,
                });
              });
            });
            describe("and has not been updated within past two weeks", () => {
              it("is not stale", () => {
                feature.dateUpdated = subWeeks(new Date(), 3);
                expect(isFeatureStale({ feature, experiments })).toMatchObject({
                  stale: false,
                });
              });
            });
          });
        });
      });
    });
  });

  describe("when feature has linked experiments", () => {
    beforeEach(() => {
      feature.linkedExperiments = ["exp_1", "exp_2", "exp_3"];
    });

    describe("if all linked experiments are inactive (stopped or draft w/ no phases)", () => {
      let experiments: ExperimentInterfaceStringDates[];
      beforeEach(() => {
        experiments = [
          genMockExperiment({ id: "exp_1", status: "stopped" }),
          genMockExperiment({ id: "exp_2", status: "draft", phases: [] }),
          genMockExperiment({ id: "exp_3", status: "stopped" }),
        ];
        feature.linkedExperiments = experiments.map((e) => e.id);
        feature.environmentSettings = {
          dev: {
            enabled: true,
            rules: experiments.map((e) =>
              genExperimentRef({
                experimentId: e.id,
              }),
            ),
          },
          prod: {
            enabled: true,
            rules: experiments.map((e) =>
              genExperimentRef({
                experimentId: e.id,
              }),
            ),
          },
        };
      });
      describe("and has been updated within past two weeks", () => {
        it("is not stale", () => {
          feature.dateUpdated = subWeeks(new Date(), 1);
          expect(isFeatureStale({ feature, experiments })).toMatchObject({
            stale: false,
          });
        });
      });
      describe("and has not been updated within past two weeks", () => {
        it("is stale", () => {
          feature.dateUpdated = subWeeks(new Date(), 3);
          expect(isFeatureStale({ feature, experiments })).toMatchObject({
            stale: true,
            reason: "rules-one-sided",
          });
        });
      });
    });
  });

  describe("when a feature is a prerequisite for a dependent feature", () => {
    let features: FeatureInterface[] = [];
    beforeEach(() => {
      features = [
        feature,
        {
          ...cloneDeep(feature),
          ...{
            id: "dependent",
            prerequisites: [
              {
                id: "feature-123",
                condition: `{"value": true}`,
              },
            ],
          },
        },
      ];
      // recent:
      features.forEach((f) => {
        f.dateUpdated = subWeeks(new Date(), 1);
      });
    });

    describe("and neither the feature nor the dependent are stale", () => {
      it("is not stale", () => {
        expect(isFeatureStale({ feature, features })).toMatchObject({
          stale: false,
        });
      });
    });

    describe("and the feature is stale but the dependent is not stale", () => {
      it("is not stale", () => {
        feature.dateUpdated = subWeeks(new Date(), 3);
        expect(isFeatureStale({ feature, features })).toMatchObject({
          stale: false,
        });
      });
    });

    describe("and the dependent is stale but the feature is not stale", () => {
      it("is not stale", () => {
        if (features?.[1]) {
          features[1].dateUpdated = subWeeks(new Date(), 3);
        }
        expect(isFeatureStale({ feature, features })).toMatchObject({
          stale: false,
        });
      });
    });

    describe("and both the feature and the dependent are stale", () => {
      it("is stale", () => {
        feature.dateUpdated = subWeeks(new Date(), 3);
        if (features?.[1]) {
          features[1].dateUpdated = subWeeks(new Date(), 3);
        }
        expect(isFeatureStale({ feature, features })).toMatchObject({
          stale: true,
          reason: "no-rules",
        });
      });
    });
  });

  describe("envResults per-environment staleness", () => {
    beforeEach(() => {
      feature.dateUpdated = new Date("2020-04-20"); // old enough
    });

    it("populates envResults for each enabled environment", () => {
      feature.environmentSettings = {
        dev: { enabled: true, rules: [] },
        prod: { enabled: true, rules: [] },
        staging: { enabled: false, rules: [] },
      };
      const result = isFeatureStale({ feature });
      expect(result.stale).toBe(true);
      expect(result.envResults).toHaveProperty("dev");
      expect(result.envResults).toHaveProperty("prod");
      expect(result.envResults).toMatchObject({
        staging: { stale: true, reason: "toggled-off" },
      });
    });

    it("sets evaluatesTo to defaultValue for no-rules envs", () => {
      feature.defaultValue = "false";
      feature.valueType = "boolean";
      feature.environmentSettings = {
        prod: { enabled: true, rules: [] },
      };
      const result = isFeatureStale({ feature });
      expect(result.envResults.prod).toMatchObject({
        stale: true,
        reason: "no-rules",
        evaluatesTo: "false",
      });
    });

    it("sets evaluatesTo to first rule value for rules-one-sided envs", () => {
      feature.defaultValue = "false";
      feature.valueType = "boolean";
      feature.environmentSettings = {
        prod: {
          enabled: true,
          rules: [
            {
              id: "r1",
              type: "force",
              enabled: true,
              value: "true",
              description: "",
              savedGroups: [],
            },
          ],
        },
      };
      const result = isFeatureStale({ feature });
      expect(result.envResults.prod).toMatchObject({
        stale: true,
        reason: "rules-one-sided",
        evaluatesTo: "true",
      });
    });

    it("omits evaluatesTo for non-stale environments", () => {
      feature.environmentSettings = {
        prod: {
          enabled: true,
          rules: [
            {
              id: "r1",
              type: "rollout",
              enabled: true,
              value: "true",
              description: "",
              coverage: 0.5,
              hashAttribute: "id",
            },
          ],
        },
      };
      const result = isFeatureStale({ feature });
      expect(result.stale).toBe(false);
      expect(result.envResults.prod).toMatchObject({ stale: false });
      expect(result.envResults.prod).not.toHaveProperty("evaluatesTo");
    });

    it("is stale only when ALL enabled environments are stale", () => {
      feature.environmentSettings = {
        dev: { enabled: true, rules: [] },
        prod: {
          enabled: true,
          rules: [
            {
              id: "r1",
              type: "rollout",
              enabled: true,
              value: "true",
              description: "",
              coverage: 0.5,
              hashAttribute: "id",
            },
          ],
        },
      };
      const result = isFeatureStale({ feature });
      expect(result.stale).toBe(false);
      expect(result.envResults.dev.stale).toBe(true);
      expect(result.envResults.prod.stale).toBe(false);
    });

    it("populates envResults even for neverStale features (counterfactual)", () => {
      feature.neverStale = true;
      feature.environmentSettings = {
        prod: { enabled: true, rules: [] },
      };
      const result = isFeatureStale({ feature });
      expect(result).toMatchObject({ stale: false, reason: "never-stale" });
      expect(result.envResults.prod).toMatchObject({
        stale: true,
        reason: "no-rules",
      });
    });

    it("populates envResults when feature was recently updated", () => {
      feature.dateUpdated = new Date(); // fresh
      feature.environmentSettings = {
        prod: { enabled: true, rules: [] },
      };
      const result = isFeatureStale({ feature });
      expect(result.stale).toBe(false);
      expect(result.reason).toBe("recently-updated");
      expect(result.envResults.prod).toMatchObject({
        stale: true,
        reason: "no-rules",
      });
    });

    it("stores JSON evaluatesTo as raw string", () => {
      feature.defaultValue = '{"key":"val"}';
      feature.valueType = "json";
      feature.environmentSettings = {
        prod: { enabled: true, rules: [] },
      };
      const result = isFeatureStale({ feature });
      expect(result.envResults.prod?.evaluatesTo).toBe('{"key":"val"}');
    });

    it("stores number evaluatesTo as raw string", () => {
      feature.defaultValue = "42";
      feature.valueType = "number";
      feature.environmentSettings = {
        prod: { enabled: true, rules: [] },
      };
      const result = isFeatureStale({ feature });
      expect(result.envResults.prod?.evaluatesTo).toBe("42");
    });

    it("treats experiment as unreachable when an unconditional rule precedes it", () => {
      const experiments = [
        genMockExperiment({ id: "exp_live", status: "running" }),
      ];
      feature.environmentSettings = {
        prod: {
          enabled: true,
          rules: [
            {
              id: "r1",
              type: "force",
              enabled: true,
              value: "foo",
              description: "",
              // no condition, no savedGroups — catches everyone
            },
            {
              type: "experiment-ref",
              enabled: true,
              description: "",
              experimentId: "exp_live",
              id: "rule_2",
              variations: [
                { variationId: "v1", value: "true" },
                { variationId: "v2", value: "false" },
              ],
            },
          ],
        },
      };
      const result = isFeatureStale({ feature, experiments });
      // experiment is shadowed — env should be stale (rules-one-sided) not active-experiment
      expect(result.envResults.prod).toMatchObject({
        stale: true,
        reason: "rules-one-sided",
      });
    });

    it("sets reason to active-experiment when env has a live experiment rule", () => {
      const experiments = [
        genMockExperiment({ id: "exp_live", status: "running" }),
      ];
      feature.environmentSettings = {
        prod: {
          enabled: true,
          rules: [
            {
              type: "experiment-ref",
              enabled: true,
              description: "",
              experimentId: "exp_live",
              id: "rule_1",
              variations: [
                { variationId: "v1", value: "true" },
                { variationId: "v2", value: "false" },
              ],
            },
          ],
        },
      };
      const result = isFeatureStale({ feature, experiments });
      expect(result.envResults.prod).toMatchObject({
        stale: false,
        reason: "active-experiment",
      });
    });

    it("sets reason to has-rules when env has two-sided targeting rules", () => {
      feature.environmentSettings = {
        prod: {
          enabled: true,
          rules: [
            {
              id: "r1",
              type: "force",
              enabled: true,
              value: "true",
              description: "",
              condition: '{"premium":true}',
            },
            {
              id: "r2",
              type: "force",
              enabled: true,
              value: "false",
              description: "",
              condition: '{"premium":false}',
            },
          ],
        },
      };
      const result = isFeatureStale({ feature });
      expect(result.envResults.prod).toMatchObject({
        stale: false,
        reason: "has-rules",
      });
    });
  });

  describe("when a feature is a prerequisite for a dependent experiment", () => {
    let experiments: ExperimentInterfaceStringDates[] = [];
    beforeEach(() => {
      feature.dateUpdated = subWeeks(new Date(), 1);
      experiments = [
        genMockExperiment({
          phases: [
            {
              coverage: 1,
              dateStarted: "2023-08-05T05:27:00Z",
              variationWeights: [0.5, 0.5],
              namespace: { enabled: false, name: "", range: [0, 1] },
              condition: '{"country": "123"}',
              name: "Main",
              reason: "",
              seed: "viusal-07",
              prerequisites: [
                { id: "feature-123", condition: `{"value": true}` },
              ],
            },
          ],
        }),
      ];
    });

    describe("and neither the feature nor the dependent exp are stale", () => {
      it("is not stale", () => {
        expect(isFeatureStale({ feature, experiments })).toMatchObject({
          stale: false,
        });
      });
    });

    describe("and the feature is stale but the dependent exp is not stale", () => {
      it("is not stale", () => {
        feature.dateUpdated = subWeeks(new Date(), 3);
        expect(isFeatureStale({ feature, experiments })).toMatchObject({
          stale: false,
        });
      });
    });

    describe("and the dependent exp is stale but the feature is not stale", () => {
      it("is not stale", () => {
        if (experiments?.[0]) {
          experiments[0].status = "stopped";
        }
        expect(isFeatureStale({ feature, experiments })).toMatchObject({
          stale: false,
        });
      });
    });

    describe("and both the feature and the dependent exp are stale", () => {
      it("is stale", () => {
        feature.dateUpdated = subWeeks(new Date(), 3);
        if (experiments?.[0]) {
          experiments[0].status = "stopped";
        }
        expect(isFeatureStale({ feature, experiments })).toMatchObject({
          stale: true,
          reason: "no-rules",
        });
      });
    });
  });

  describe("mixed global/per-env stale states", () => {
    beforeEach(() => {
      feature.dateUpdated = new Date("2020-04-20"); // old enough by default
    });

    it("global not stale when only some envs are stale", () => {
      feature.environmentSettings = {
        dev: { enabled: true, rules: [] },
        prod: {
          enabled: true,
          rules: [
            {
              id: "r1",
              type: "rollout",
              enabled: true,
              value: "true",
              description: "",
              coverage: 0.5,
              hashAttribute: "id",
            },
          ],
        },
      };
      const result = isFeatureStale({ feature });
      expect(result.stale).toBe(false);
      expect(result.envResults.dev).toMatchObject({
        stale: true,
        reason: "no-rules",
      });
      expect(result.envResults.prod).toMatchObject({ stale: false });
    });

    it("neverStale: global false but envResults reflect counterfactual stale state", () => {
      feature.neverStale = true;
      feature.environmentSettings = {
        dev: { enabled: true, rules: [] },
        prod: {
          enabled: true,
          rules: [
            {
              id: "r1",
              type: "force",
              enabled: true,
              value: "true",
              description: "",
              savedGroups: [],
            },
          ],
        },
      };
      const result = isFeatureStale({ feature });
      expect(result).toMatchObject({ stale: false, reason: "never-stale" });
      expect(result.envResults.dev).toMatchObject({
        stale: true,
        reason: "no-rules",
      });
      expect(result.envResults.prod).toMatchObject({
        stale: true,
        reason: "rules-one-sided",
      });
    });

    it("recently-updated: global false but envResults are stale", () => {
      feature.dateUpdated = subWeeks(new Date(), 1);
      feature.environmentSettings = {
        prod: { enabled: true, rules: [] },
      };
      const result = isFeatureStale({ feature });
      expect(result).toMatchObject({
        stale: false,
        reason: "recently-updated",
      });
      expect(result.envResults.prod).toMatchObject({
        stale: true,
        reason: "no-rules",
      });
    });

    it("active-draft: global false but envResults are stale", () => {
      feature.environmentSettings = {
        prod: { enabled: true, rules: [] },
      };
      const result = isFeatureStale({
        feature,
        mostRecentDraftDate: new Date(), // draft updated just now
      });
      expect(result).toMatchObject({ stale: false, reason: "active-draft" });
      expect(result.envResults.prod).toMatchObject({
        stale: true,
        reason: "no-rules",
      });
    });

    it("abandoned-draft: not globally stale when at least one env is not stale", () => {
      feature.environmentSettings = {
        dev: { enabled: true, rules: [] },
        prod: {
          enabled: true,
          rules: [
            {
              id: "r1",
              type: "rollout",
              enabled: true,
              value: "true",
              description: "",
              coverage: 0.5,
              hashAttribute: "id",
            },
          ],
        },
      };
      const abandonedDate = new Date();
      abandonedDate.setMonth(abandonedDate.getMonth() - 2);
      const result = isFeatureStale({
        feature,
        mostRecentDraftDate: abandonedDate,
      });
      // prod is not stale (two-sided rules) so the feature is not globally stale
      // even though there is an abandoned draft
      expect(result).toMatchObject({ stale: false });
      expect(result.envResults.dev).toMatchObject({
        stale: true,
        reason: "no-rules",
      });
      expect(result.envResults.prod).toMatchObject({ stale: false });
    });

    it("abandoned-draft: globally stale when all envs are also stale", () => {
      feature.environmentSettings = {
        dev: { enabled: true, rules: [] },
        prod: { enabled: true, rules: [] },
      };
      const abandonedDate = new Date();
      abandonedDate.setMonth(abandonedDate.getMonth() - 2);
      const result = isFeatureStale({
        feature,
        mostRecentDraftDate: abandonedDate,
      });
      expect(result).toMatchObject({ stale: true, reason: "abandoned-draft" });
      expect(result.envResults.dev).toMatchObject({
        stale: true,
        reason: "no-rules",
      });
      expect(result.envResults.prod).toMatchObject({
        stale: true,
        reason: "no-rules",
      });
    });

    it("has-dependents: global false but envResults are stale", () => {
      feature.environmentSettings = {
        prod: { enabled: true, rules: [] },
      };
      const dependentExp = genMockExperiment({
        id: "exp_dep",
        status: "running",
      });
      dependentExp.phases[0].prerequisites = [
        { id: feature.id, condition: `{"value": true}` },
      ];
      const result = isFeatureStale({
        feature,
        experiments: [dependentExp],
        dependentExperiments: [dependentExp],
      });
      expect(result).toMatchObject({ stale: false, reason: "has-dependents" });
      expect(result.envResults.prod).toMatchObject({
        stale: false,
        reason: "has-dependents",
      });
    });

    it("global stale reason is most severe across all stale envs", () => {
      feature.environmentSettings = {
        dev: { enabled: true, rules: [] }, // no-rules
        prod: {
          enabled: true,
          rules: [
            {
              id: "r1",
              type: "force",
              enabled: true,
              value: "true",
              description: "",
              savedGroups: [],
            },
          ],
        }, // rules-one-sided
      };
      const result = isFeatureStale({ feature });
      expect(result).toMatchObject({ stale: true, reason: "no-rules" });
      expect(result.envResults.dev).toMatchObject({
        stale: true,
        reason: "no-rules",
      });
      expect(result.envResults.prod).toMatchObject({
        stale: true,
        reason: "rules-one-sided",
      });
    });
  });
});
