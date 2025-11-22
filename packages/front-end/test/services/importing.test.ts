import { FeatureInterface } from "back-end/types/feature";
import {
  LDListFeatureFlagsResponse,
  transformLDEnvironmentsToGBEnvironment,
  transformLDFeatureFlagToGBFeature,
  transformLDProjectsToGBProject,
} from "@/services/importing/launchdarkly/launchdarkly-importing";

describe("importing utils", () => {
  describe("transformLDEnvironmentsToGBEnvironment", () => {
    it("should transform the LD environments payload", () => {
      const input = {
        _links: {
          parent: {
            href: "/api/v2/projects/default",
            type: "application/json",
          },
          self: {
            href: "/api/v2/projects/default/environments?limit=20",
            type: "application/json",
          },
        },
        totalCount: 2,
        items: [
          {
            _links: {
              analytics: {
                href: "https://app.launchdarkly.com/snippet/events/v1/xx.js",
                type: "text/html",
              },
              apiKey: {
                href: "/api/v2/projects/default/environments/development/apiKey",
                type: "application/json",
              },
              mobileKey: {
                href: "/api/v2/projects/default/environments/development/mobileKey",
                type: "application/json",
              },
              self: {
                href: "/api/v2/projects/default/environments/development",
                type: "application/json",
              },
              snippet: {
                href: "https://app.launchdarkly.com/snippet/features/xx.js",
                type: "text/html",
              },
            },
            _id: "xx",
            _pubnub: {
              channel: "xx",
              cipherKey: "xx",
            },
            key: "development",
            name: "Development",
            color: "ff9460",
            tags: [],
          },
          {
            _links: {
              analytics: {
                href: "https://app.launchdarkly.com/snippet/events/v1/xx.js",
                type: "text/html",
              },
              apiKey: {
                href: "/api/v2/projects/default/environments/production/apiKey",
                type: "application/json",
              },
              mobileKey: {
                href: "/api/v2/projects/default/environments/production/mobileKey",
                type: "application/json",
              },
              self: {
                href: "/api/v2/projects/default/environments/production",
                type: "application/json",
              },
              snippet: {
                href: "https://app.launchdarkly.com/snippet/features/xx.js",
                type: "text/html",
              },
            },
            _id: "xx",
            _pubnub: {
              channel: "xx",
              cipherKey: "xxx",
            },
            key: "production",
            name: "Production",
            color: "ec118a",
            tags: [],
          },
        ],
      };

      const result = transformLDEnvironmentsToGBEnvironment(input);

      expect(result).toEqual([
        {
          id: "development",
          description: "Development",
        },
        {
          id: "production",
          description: "Production",
        },
      ]);
    });
  });

  describe("transformLDProjectsToGBProject", () => {
    it("should transform the LD projects payload", () => {
      const input = {
        _links: {
          self: {
            href: "/api/v2/projects?limit=20",
            type: "application/json",
          },
        },
        items: [
          {
            _links: {
              environments: {
                href: "/api/v2/projects/my-first-project/environments",
                type: "application/json",
              },
              flagDefaults: {
                href: "/api/v2/projects/my-first-project/flag-defaults",
                type: "application/json",
              },
              self: {
                href: "/api/v2/projects/my-first-project",
                type: "application/json",
              },
            },
            _id: "xx",
            key: "my-first-project",
            includeInSnippetByDefault: false,
            defaultClientSideAvailability: {
              usingMobileKey: false,
              usingEnvironmentId: false,
            },
            name: "My First Project",
            tags: [],
          },
          {
            _links: {
              environments: {
                href: "/api/v2/projects/default/environments",
                type: "application/json",
              },
              flagDefaults: {
                href: "/api/v2/projects/default/flag-defaults",
                type: "application/json",
              },
              self: {
                href: "/api/v2/projects/default",
                type: "application/json",
              },
            },
            _id: "xx",
            key: "default",
            includeInSnippetByDefault: false,
            defaultClientSideAvailability: {
              usingMobileKey: false,
              usingEnvironmentId: false,
            },
            name: "My Default Project",
            tags: ["checkout"],
          },
        ],
        totalCount: 2,
      };

      const result = transformLDProjectsToGBProject(input);

      expect(result).toEqual([
        {
          id: "my-first-project",
          name: "My First Project",
          description: "",
        },
        {
          id: "default",
          name: "My Default Project",
          description: "",
        },
      ]);
    });
  });

  describe("transformLDFeatureFlagToGBEnvironment", () => {
    it("should transform the LD feature flag payload for a boolean feature", () => {
      const booleanTypeInput = {
        _links: {
          self: {
            href: "/api/v2/flags/default?summary=true",
            type: "application/json",
          },
        },
        items: [
          {
            _links: {
              parent: {
                href: "/api/v2/flags/default",
                type: "application/json",
              },
              self: {
                href: "/api/v2/flags/default/some_feature",
                type: "application/json",
              },
            },
            _maintainer: {
              _id: "xx",
              _links: {
                self: {
                  href: "/api/v2/members/xx",
                  type: "application/json",
                },
              },
              email: "email@email.com",
              firstName: "Firstname",
              lastName: "Lastname",
              role: "owner",
            },
            _version: 1,
            archived: false,
            clientSideAvailability: {
              usingEnvironmentId: true,
              usingMobileKey: false,
            },
            creationDate: 1686100000000,
            customProperties: {},
            defaults: {
              offVariation: 1,
              onVariation: 0,
            },
            description: "Whether some feature should be displayed or not",
            environments: {
              development: {
                _environmentName: "Development",
                _site: {
                  href: "/default/development/features/some_feature",
                  type: "text/html",
                },
                _summary: {
                  prerequisites: 0,
                  variations: {
                    "0": {
                      isFallthrough: true,
                      nullRules: 0,
                      rules: 0,
                      targets: 0,
                    },
                    "1": {
                      isOff: true,
                      nullRules: 0,
                      rules: 0,
                      targets: 0,
                    },
                  },
                },
                archived: false,
                lastModified: 1686100000000,
                on: false,
                salt: "xx",
                sel: "xx",
                trackEvents: false,
                trackEventsFallthrough: false,
                version: 1,
              },
              production: {
                _environmentName: "Production",
                _site: {
                  href: "/default/production/features/some_feature",
                  type: "text/html",
                },
                _summary: {
                  prerequisites: 0,
                  variations: {
                    "1": {
                      isFallthrough: true,
                      isOff: true,
                      nullRules: 0,
                      rules: 0,
                      targets: 0,
                    },
                  },
                },
                archived: false,
                lastModified: 1686100000000,
                on: false,
                salt: "xx",
                sel: "xx",
                trackEvents: false,
                trackEventsFallthrough: false,
                version: 2,
              },
            },
            experiments: {
              baselineIdx: 0,
              items: [],
            },
            goalIds: [],
            includeInSnippet: true,
            key: "some_feature",
            kind: "boolean",
            maintainerId: "xx",
            name: "some_feature",
            tags: ["tag_1", "tag_2"],
            temporary: true,
            variationJsonSchema: null,
            variations: [
              {
                _id: "variation-x",
                value: true,
              },
              {
                _id: "variation-z",
                value: false,
              },
            ],
          },
        ],
        totalCount: 1,
      };
      const expected: Omit<
        FeatureInterface,
        "dateCreated" | "dateUpdated" | "version" | "organization"
      >[] = [
        {
          id: "some_feature",
          tags: ["tag_1", "tag_2"],
          project: "prj_abc1234",
          description: "Whether some feature should be displayed or not",
          owner: "Firstname Lastname (email@email.com)",
          defaultValue: "true",
          environmentSettings: {
            development: {
              enabled: false,
            },
            production: {
              enabled: false,
            },
          },
          rules: [
            {
              id: "rule_fallthrough",
              description: "Fallthrough",
              enabled: true,
              type: "force",
              value: "false",
              condition: "{}",
              savedGroups: [],
              uid: "test-uid-1",
              environments: ["production"],
              allEnvironments: false,
            },
          ],
          valueType: "boolean",
        },
      ];

      const result = transformLDFeatureFlagToGBFeature(
        booleanTypeInput,
        "prj_abc1234",
      );

      expect(result).toEqual(expected);
    });

    it("should transform complex feature with multiple rules, targets, and prerequisites", () => {
      const result = transformLDFeatureFlagToGBFeature(
        {
          _links: {
            self: {
              href: "/api/v2/flags/my-first-project?summary=true",
            },
          },
          items: [
            {
              name: "ff-test-multiple-targets",
              kind: "multivariate",
              description: "",
              key: "ff-test-multiple-targets",
              _version: 1,
              creationDate: 1706730000000,
              includeInSnippet: false,
              clientSideAvailability: {
                usingMobileKey: false,
                usingEnvironmentId: false,
              },
              variations: [
                {
                  _id: "a",
                  value: 1,
                  name: "n1",
                },
                {
                  _id: "b",
                  value: 2,
                  name: "n2",
                },
                {
                  _id: "c",
                  value: 3,
                  name: "n3",
                },
                {
                  _id: "d",
                  value: 4,
                  name: "n4",
                },
              ],
              variationJsonSchema: null,
              temporary: false,
              tags: [],
              _links: {
                parent: {
                  href: "/api/v2/flags/ld-to-gb-migration-testing",
                  type: "application/json",
                },
                self: {
                  href: "/api/v2/flags/ld-to-gb-migration-testing/ff-test-multiple-targets",
                  type: "application/json",
                },
              },
              maintainerId: "",
              _maintainer: {
                _links: {
                  self: {
                    href: "",
                    type: "application/json",
                  },
                },
                _id: "",
                firstName: "Growth",
                lastName: "Book",
                role: "admin",
                email: "hello@growthbook.io",
              },
              goalIds: [],
              experiments: {
                baselineIdx: 0,
                items: [],
              },
              customProperties: {},
              archived: false,
              deprecated: false,
              defaults: {
                onVariation: 0,
                offVariation: 1,
              },
              environments: {
                production: {
                  on: true,
                  archived: false,
                  salt: "abcdef123456",
                  sel: "123456abcdef",
                  lastModified: 1706730000000,
                  version: 4,
                  targets: [],
                  contextTargets: [],
                  rules: [
                    {
                      _id: "r1",
                      variation: 2,
                      clauses: [
                        {
                          _id: "r1c1",
                          attribute: "firstName",
                          op: "in",
                          values: ["a", "b", "c"],
                          contextKind: "user",
                          negate: false,
                        },
                      ],
                      trackEvents: false,
                      description: "Rule 1",
                      ref: "r1ref",
                    },
                    {
                      _id: "r2",
                      variation: 2,
                      clauses: [
                        {
                          _id: "r2c1",
                          attribute: "key",
                          op: "in",
                          values: ["new test"],
                          contextKind: "testing",
                          negate: false,
                        },
                        {
                          _id: "r2c2",
                          attribute: "email",
                          op: "in",
                          values: ["abc@growthbook.io", "def@growthbook.io"],
                          contextKind: "user",
                          negate: false,
                        },
                      ],
                      trackEvents: false,
                      description: "Rule 2",
                      ref: "r2ref",
                    },
                  ],
                  fallthrough: {
                    variation: 0,
                  },
                  offVariation: 1,
                  prerequisites: [
                    {
                      key: "ff-test-multiple-rules",
                      variation: 1,
                    },
                  ],
                  _site: {
                    href: "/ld-to-gb-migration-testing/production/features/ff-test-multiple-targets",
                    type: "text/html",
                  },
                  _environmentName: "Production",
                  trackEvents: false,
                  trackEventsFallthrough: false,
                  _summary: {
                    variations: {
                      "0": {
                        rules: 0,
                        nullRules: 0,
                        targets: 0,
                        contextTargets: 0,
                        isFallthrough: true,
                      },
                      "1": {
                        rules: 0,
                        nullRules: 0,
                        targets: 0,
                        contextTargets: 0,
                        isOff: true,
                      },
                      "2": {
                        rules: 2,
                        nullRules: 0,
                        targets: 0,
                        contextTargets: 0,
                      },
                    },
                    prerequisites: 1,
                  },
                },
                test: {
                  on: false,
                  archived: false,
                  salt: "abcdef123456",
                  sel: "1234567fafda",
                  lastModified: 1706730000000,
                  version: 1,
                  targets: [],
                  contextTargets: [],
                  rules: [],
                  fallthrough: {
                    variation: 0,
                  },
                  offVariation: 1,
                  prerequisites: [],
                  _site: {
                    href: "/ld-to-gb-migration-testing/test/features/ff-test-multiple-targets",
                    type: "text/html",
                  },
                  _environmentName: "Test",
                  trackEvents: false,
                  trackEventsFallthrough: false,
                  _summary: {
                    variations: {
                      "0": {
                        rules: 0,
                        nullRules: 0,
                        targets: 0,
                        contextTargets: 0,
                        isFallthrough: true,
                      },
                      "1": {
                        rules: 0,
                        nullRules: 0,
                        targets: 0,
                        contextTargets: 0,
                        isOff: true,
                      },
                    },
                    prerequisites: 0,
                  },
                },
              },
            },
            {
              name: "ff-test-multiple-rules",
              kind: "multivariate",
              description: "",
              key: "ff-test-multiple-rules",
              _version: 1,
              creationDate: 1706720000000,
              includeInSnippet: false,
              clientSideAvailability: {
                usingMobileKey: false,
                usingEnvironmentId: false,
              },
              variations: [
                {
                  _id: "a",
                  value: "a",
                  name: "x",
                },
                {
                  _id: "b",
                  value: "b",
                  name: "y",
                },
                {
                  _id: "c",
                  value: "c",
                  name: "z",
                },
              ],
              variationJsonSchema: null,
              temporary: false,
              tags: [],
              _links: {
                parent: {
                  href: "/api/v2/flags/ld-to-gb-migration-testing",
                  type: "application/json",
                },
                self: {
                  href: "/api/v2/flags/ld-to-gb-migration-testing/ff-test-multiple-rules",
                  type: "application/json",
                },
              },
              maintainerId: "",
              _maintainer: {
                _links: {
                  self: {
                    href: "",
                    type: "application/json",
                  },
                },
                _id: "",
                firstName: "Growth",
                lastName: "Book",
                role: "admin",
                email: "hello@growthbook.io",
              },
              goalIds: [],
              experiments: {
                baselineIdx: 0,
                items: [],
              },
              customProperties: {},
              archived: false,
              deprecated: false,
              defaults: {
                onVariation: 0,
                offVariation: 1,
              },
              environments: {
                production: {
                  on: true,
                  archived: false,
                  salt: "abc123",
                  sel: "def123",
                  lastModified: 1706730000000,
                  version: 4,
                  targets: [],
                  contextTargets: [],
                  rules: [
                    {
                      _id: "abcdef-1234-abcd-1234-abcdef123456",
                      rollout: {
                        variations: [
                          {
                            variation: 0,
                            weight: 80000,
                          },
                          {
                            variation: 1,
                            weight: 20000,
                          },
                          {
                            variation: 2,
                            weight: 0,
                          },
                        ],
                        contextKind: "user",
                      },
                      clauses: [
                        {
                          _id: "abcdef-1234-abcd-1234-abcdef123457",
                          attribute: "segmentMatch",
                          op: "segmentMatch",
                          values: ["seg-1"],
                          contextKind: "user",
                          negate: false,
                        },
                      ],
                      trackEvents: false,
                    },
                    {
                      _id: "abcdef-1234-abcd-1234-abcdef123458",
                      variation: 1,
                      clauses: [
                        {
                          _id: "abcdef-1234-abcd-1234-abcdef123459",
                          attribute: "not-segmentMatch",
                          op: "segmentMatch",
                          values: ["seg-2"],
                          contextKind: "user",
                          negate: true,
                        },
                      ],
                      trackEvents: false,
                      description: "Rule 2",
                    },
                  ],
                  fallthrough: {
                    variation: 0,
                  },
                  offVariation: 1,
                  prerequisites: [],
                  _site: {
                    href: "/ld-to-gb-migration-testing/production/features/ff-test-multiple-rules",
                    type: "text/html",
                  },
                  _environmentName: "Production",
                  trackEvents: false,
                  trackEventsFallthrough: false,
                  _summary: {
                    variations: {
                      "0": {
                        rules: 1,
                        nullRules: 0,
                        targets: 0,
                        contextTargets: 0,
                        isFallthrough: true,
                      },
                      "1": {
                        rules: 2,
                        nullRules: 0,
                        targets: 0,
                        contextTargets: 0,
                        isOff: true,
                      },
                      "2": {
                        rules: 1,
                        nullRules: 1,
                        targets: 0,
                        contextTargets: 0,
                      },
                    },
                    prerequisites: 0,
                  },
                },
              },
            },
          ],
        } as unknown as LDListFeatureFlagsResponse,
        "prj_xyz987",
      );

      // Rules are now in top-level rules array, not in environmentSettings
      const ruleIds0 = result?.[0]?.rules
        ?.filter(
          (r) => r.allEnvironments || r.environments?.includes("production"),
        )
        ?.map((r) => r.id);
      const ruleIds1 = result?.[1]?.rules
        ?.filter(
          (r) => r.allEnvironments || r.environments?.includes("production"),
        )
        ?.map((r) => r.id);

      const expected: Omit<
        FeatureInterface,
        "dateCreated" | "dateUpdated" | "version" | "organization"
      >[] = [
        {
          id: "ff-test-multiple-targets",
          tags: [],
          project: "prj_xyz987",
          description: "",
          owner: "Growth Book (hello@growthbook.io)",
          defaultValue: "1",
          environmentSettings: {
            production: {
              enabled: true,
            },
            test: {
              enabled: false,
            },
          },
          rules: [
            {
              id: ruleIds0[0],
              description: "Prerequisite feature 1",
              enabled: true,
              type: "force",
              prerequisites: [
                {
                  condition: JSON.stringify({ value: { $ne: "b" } }),
                  id: "ff-test-multiple-rules",
                },
              ],
              value: "2",
              condition: "",
              savedGroups: [],
              uid: "test-uid-prereq-1",
              environments: ["production"],
              allEnvironments: false,
            },
            {
              id: ruleIds0[1] || "",
              description: "Rule 1",
              enabled: true,
              type: "force",
              value: "3",
              condition: JSON.stringify({
                firstName: {
                  $in: ["a", "b", "c"],
                },
              }),
              savedGroups: [],
              uid: "test-uid-rule-1",
              environments: ["production"],
              allEnvironments: false,
            },
            {
              id: ruleIds0[2] || "",
              description: "Rule 2",
              enabled: true,
              type: "force",
              value: "3",
              condition: JSON.stringify({
                $and: [
                  {
                    key: { $eq: "new test" },
                  },
                  {
                    email: {
                      $in: ["abc@growthbook.io", "def@growthbook.io"],
                    },
                  },
                ],
              }),
              savedGroups: [],
              uid: "test-uid-rule-2",
              environments: ["production"],
              allEnvironments: false,
            },
          ],
          valueType: "number",
        },
        {
          id: "ff-test-multiple-rules",
          tags: [],
          project: "prj_xyz987",
          description: "",
          owner: "Growth Book (hello@growthbook.io)",
          defaultValue: "a",
          environmentSettings: {
            production: {
              enabled: true,
            },
          },
          rules: [
            {
              id: ruleIds1[0] || "",
              description: "",
              enabled: true,
              type: "experiment",
              condition: JSON.stringify({
                id: {
                  $inGroup: "seg-1",
                },
              }),
              hashAttribute: "id",
              trackingKey: "abcdef-1234-abcd-1234-abcdef123456",
              values: [
                {
                  value: "a",
                  weight: 0.8,
                },
                {
                  value: "b",
                  weight: 0.2,
                },
                {
                  value: "c",
                  weight: 0,
                },
              ],
              coverage: 1,
              savedGroups: [],
              uid: "test-uid-exp-1",
              environments: ["production"],
              allEnvironments: false,
            },
            {
              id: ruleIds1[1] || "",
              description: "Rule 2",
              enabled: true,
              type: "force",
              value: "b",
              condition: JSON.stringify({
                $not: {
                  id: {
                    $inGroup: "seg-2",
                  },
                },
              }),
              savedGroups: [],
              uid: "test-uid-rule-2-2",
              environments: ["production"],
              allEnvironments: false,
            },
          ],
          valueType: "string",
        },
      ];

      expect(result).toEqual(expected);
    });

    it("should transform the LD feature flag payload for a string feature", () => {
      const stringTypeInput = {
        _links: {
          self: {
            href: "/api/v2/flags/my-first-project?summary=true",
            type: "application/json",
          },
        },
        items: [
          {
            _links: {
              parent: {
                href: "/api/v2/flags/my-first-project",
                type: "application/json",
              },
              self: {
                href: "/api/v2/flags/my-first-project/custom_banner_html",
                type: "application/json",
              },
            },
            _maintainer: {
              _id: "xx",
              _links: {
                self: {
                  href: "/api/v2/members/xx",
                  type: "application/json",
                },
              },
              email: "email@email.com",
              firstName: "Firstname",
              lastName: "Lastname",
              role: "owner",
            },
            _version: 2,
            archived: false,
            clientSideAvailability: {
              usingEnvironmentId: true,
              usingMobileKey: false,
            },
            creationDate: 1686100000000,
            customProperties: {},
            defaults: {
              offVariation: 0,
              onVariation: 1,
            },
            description: "HTML that will be injected",
            environments: {
              development: {
                _environmentName: "Development",
                _site: {
                  href: "/my-first-project/development/features/custom_banner_html",
                  type: "text/html",
                },
                _summary: {
                  prerequisites: 0,
                  variations: {
                    "0": {
                      isOff: true,
                      nullRules: 0,
                      rules: 0,
                      targets: 0,
                    },
                    "1": {
                      isFallthrough: true,
                      nullRules: 0,
                      rules: 0,
                      targets: 0,
                    },
                  },
                },
                archived: false,
                lastModified: 1686100000000,
                on: false,
                salt: "xx",
                sel: "xx",
                trackEvents: false,
                trackEventsFallthrough: false,
                version: 1,
              },
              production: {
                _environmentName: "Production",
                _site: {
                  href: "/my-first-project/production/features/custom_banner_html",
                  type: "text/html",
                },
                _summary: {
                  prerequisites: 0,
                  variations: {
                    "0": {
                      isFallthrough: true,
                      isOff: true,
                      nullRules: 0,
                      rules: 0,
                      targets: 0,
                    },
                  },
                },
                archived: false,
                lastModified: 1686100000000,
                on: false,
                salt: "xx",
                sel: "xx",
                trackEvents: false,
                trackEventsFallthrough: false,
                version: 2,
              },
              staging: {
                _environmentName: "Staging",
                _site: {
                  href: "/my-first-project/staging/features/custom_banner_html",
                  type: "text/html",
                },
                _summary: {
                  prerequisites: 0,
                  variations: {
                    "0": {
                      isOff: true,
                      nullRules: 0,
                      rules: 0,
                      targets: 0,
                    },
                    "1": {
                      isFallthrough: true,
                      nullRules: 0,
                      rules: 0,
                      targets: 0,
                    },
                  },
                },
                archived: false,
                lastModified: 1686100000000,
                on: false,
                salt: "xx",
                sel: "xx",
                trackEvents: false,
                trackEventsFallthrough: false,
                version: 1,
              },
            },
            experiments: {
              baselineIdx: 0,
              items: [],
            },
            goalIds: [],
            includeInSnippet: true,
            key: "custom_banner_html",
            kind: "multivariate",
            maintainerId: "xx",
            name: "custom_banner_html",
            tags: ["tag_1", "tag_2"],
            temporary: false,
            variationJsonSchema: null,
            variations: [
              {
                _id: "variation-id-xx",
                description: "No messaging should hide the banner",
                name: "none",
                value: "",
              },
              {
                _id: "variation-id-zz",
                description: "Advertising the app",
                name: "android ad",
                value: "<p>Now on Android! Click <a href='#'>here</a>!</p>",
              },
            ],
          },
        ],
        totalCount: 1,
      };
      const expected: Omit<
        FeatureInterface,
        "dateCreated" | "dateUpdated" | "version" | "organization"
      >[] = [
        {
          id: "custom_banner_html",
          tags: ["tag_1", "tag_2"],
          project: "prj_xyz987",
          description: "HTML that will be injected",
          owner: "Firstname Lastname (email@email.com)",
          defaultValue: "<p>Now on Android! Click <a href='#'>here</a>!</p>",
          environmentSettings: {
            development: {
              enabled: false,
            },
            staging: {
              enabled: false,
            },
            production: {
              enabled: false,
            },
          },
          rules: [
            {
              id: "rule_fallthrough",
              description: "Fallthrough",
              enabled: true,
              type: "force",
              value: "",
              condition: "{}",
              savedGroups: [],
              uid: "test-uid-fallthrough",
              environments: ["production"],
              allEnvironments: false,
            },
          ],
          valueType: "string",
        },
      ];

      const result = transformLDFeatureFlagToGBFeature(
        stringTypeInput,
        "prj_xyz987",
      );

      expect(result).toEqual(expected);
    });
  });
});
