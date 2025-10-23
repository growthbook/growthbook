import { getSDKCapabilities, getSDKVersions } from "shared/sdk-versioning";
import {
  validateEnvironment,
  validateLanguage,
  validateName,
  validatePremiumFeatures,
  validateProjects,
  validateSdkCapabilities,
  validateSdkVersion,
} from "back-end/src/api/sdk-connections/validations";
import { getEnvironments } from "back-end/src/services/organizations";

jest.mock("back-end/src/services/organizations", () => ({
  getEnvironments: jest.fn(),
}));

jest.mock("shared/sdk-versioning", () => ({
  getSDKCapabilities: jest.fn(),
  getSDKVersions: jest.fn(),
}));

describe("sdk-connections validations", () => {
  const org = { id: "org", environments: [{ id: "production" }] };

  describe("name validation", () => {
    it("Fails the empty string", () => {
      expect(() => {
        validateName("");
      }).toThrow("Name length must be at least 3 characters");
    });

    it("Fails short strings", () => {
      expect(() => {
        validateName("Hi");
      }).toThrow("Name length must be at least 3 characters");
    });

    it("Allows strings of at least 3 characters", () => {
      expect(() => {
        validateName("123");
      }).not.toThrow();
    });
  });

  describe("environment validation", () => {
    beforeEach(() => {
      getEnvironments.mockReturnValue([{ id: "env_id" }]);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it("Fails nonexistent environments", () => {
      expect(() => {
        validateEnvironment(org, "nonexistent_env");
      }).toThrow("Environment nonexistent_env does not exist!");
      expect(getEnvironments).toHaveBeenCalledWith(org);
    });

    it("Allows environments that exist", () => {
      expect(() => {
        validateEnvironment(org, "env_id");
      }).not.toThrow();
      expect(getEnvironments).toHaveBeenCalledWith(org);
    });
  });

  describe("project validation", () => {
    const context = {
      models: {
        projects: {
          getAll: async () => {
            return [{ id: "project_1" }, { id: "project_2" }];
          },
        },
      },
    };

    it("Fails when a project doesn't exist", async () => {
      await expect(
        validateProjects(context, ["project_2", "project_3"]),
      ).rejects.toThrow("The following projects do not exist: project_3");
    });

    it("Allows projects that exist", async () => {
      await expect(
        validateProjects(context, ["project_1", "project_2"]),
      ).resolves.not.toThrow();
    });
  });

  describe("language validation", () => {
    it("Fails languages that don't exist", () => {
      expect(() => {
        validateLanguage("not_a_language");
      }).toThrow("Language not_a_language is not supported!");
    });

    it("Allows languages that we support", () => {
      expect(() => {
        validateLanguage("javascript");
      }).not.toThrow();
    });
  });

  describe("sdk capability validation", () => {
    beforeEach(() => {
      getSDKCapabilities.mockImplementation(
        (language: string, version: string | undefined) => {
          if (language === "javascript") {
            if (version === "old_version") return ["encryption"];
            if (version === "latest_version")
              return ["encryption", "remoteEval"];
          }
          return ["encryption"];
        },
      );
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it("Prompts upgrades when needed for a capability", () => {
      expect(() => {
        validateSdkCapabilities(
          { encryptPayload: true, remoteEvalEnabled: true },
          "javascript",
          "old_version",
          "latest_version",
        );
      }).toThrow(
        "You need to ugrade to version latest_version to support remoteEval",
      );
    });

    it("Throws when a capability is unsupported", () => {
      expect(() => {
        validateSdkCapabilities(
          { encryptPayload: true, remoteEvalEnabled: true },
          "other_language",
          "latest_version",
          "latest_version",
        );
      }).toThrow("SDK version latest_version does not support remoteEval");
    });

    it("Allows supported capabilities", () => {
      expect(() => {
        validateSdkCapabilities(
          { encryptPayload: true, remoteEvalEnabled: false },
          "other_language",
          "latest_version",
          "latest_version",
        );
      }).not.toThrow();
    });
  });

  describe("premium feature validation", () => {
    const context = {
      hasPremiumFeature: (feature: string) =>
        feature === "encrypt-features-endpoint",
    };

    it("Ignores disabled features", () => {
      expect(() => {
        validatePremiumFeatures(context, {
          encryptPayload: false,
          includeVisualExperiments: false,
        });
      }).not.toThrow();
    });

    it("Allows premium overriden features", () => {
      expect(() => {
        validatePremiumFeatures(context, { proxyEnabled: true });
      }).not.toThrow();
    });

    it("Fails unpurchased features", () => {
      expect(() => {
        validatePremiumFeatures(context, {
          encryptPayload: false,
          hashSecureAttributes: true,
        });
      }).toThrow(
        "Feature hash-secure-attributes requires premium subscription!",
      );
    });

    it("Allows available features", () => {
      expect(() => {
        validatePremiumFeatures(context, { encryptPayload: true });
      }).not.toThrow();
    });
  });

  describe("sdk version validation", () => {
    beforeEach(() => {
      getSDKVersions.mockImplementation((language: string) =>
        language === "javascript" ? ["js_old", "js_latest"] : ["other_old"],
      );
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it("Fails nonexistent versions", () => {
      expect(() => {
        validateSdkVersion("js_doesnt_exist", "javascript");
      }).toThrow("SDK version js_doesnt_exist does not exist for javascript");
    });

    it("Fails versions that only exist on other languages", () => {
      expect(() => {
        validateSdkVersion("js_latest", "other_lang");
      }).toThrow("SDK version js_latest does not exist for other_lang");
    });

    it("Allows valid versions", () => {
      expect(() => {
        validateSdkVersion("other_old", "other_lang");
      }).not.toThrow();

      expect(() => {
        validateSdkVersion("js_latest", "javascript");
      }).not.toThrow();
    });
  });
});
