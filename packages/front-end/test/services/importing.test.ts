import { FeatureInterface } from "back-end/types/feature";
import {
  transformLDEnvironmentsToGBEnvironment,
  transformLDFeatureFlagToGBFeature,
  transformLDProjectsToGBProject,
} from "@/services/importing";

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
                href:
                  "/api/v2/projects/default/environments/development/apiKey",
                type: "application/json",
              },
              mobileKey: {
                href:
                  "/api/v2/projects/default/environments/development/mobileKey",
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
                href:
                  "/api/v2/projects/default/environments/production/mobileKey",
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
          name: "my-first-project",
          description: "My First Project",
        },
        {
          name: "default",
          description: "My Default Project",
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
          defaultValue: "false",
          environmentSettings: {
            development: {
              rules: [],
              enabled: false,
            },
            production: {
              rules: [],
              enabled: false,
            },
          },
          valueType: "boolean",
        },
      ];

      const result = transformLDFeatureFlagToGBFeature(
        booleanTypeInput,
        "prj_abc1234"
      );

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
                  href:
                    "/my-first-project/development/features/custom_banner_html",
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
                  href:
                    "/my-first-project/production/features/custom_banner_html",
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
          defaultValue: "",
          environmentSettings: {
            development: {
              enabled: false,
              rules: [],
            },
            staging: {
              enabled: false,
              rules: [],
            },
            production: {
              enabled: false,
              rules: [],
            },
          },
          valueType: "string",
        },
      ];

      const result = transformLDFeatureFlagToGBFeature(
        stringTypeInput,
        "prj_xyz987"
      );

      expect(result).toEqual(expected);
    });
  });
});
