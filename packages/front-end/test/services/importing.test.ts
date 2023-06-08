import {
  transformLDEnvironmentsToGBEnvironment,
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
});
