import { Environment } from "../../types/organization";
import { deepFreeze } from "../test-helpers";
import {
  addEnvironmentToOrganizationEnvironments,
  containsEnvironment,
} from "../../src/util/environments";

describe("environment utils", () => {
  describe("addEnvironmentToOrganizationEnvironments", () => {
    const existingEnvironments: Environment[] = [
      {
        id: "staging",
        description: "",
        toggleOnList: true,
        defaultState: true,
      },
      {
        id: "production",
        description: "My existing production environment",
        toggleOnList: false,
        defaultState: true,
      },
    ];

    beforeEach(() => {
      deepFreeze(existingEnvironments);
    });

    it("should append the environment to the existing environments", () => {
      const input: Environment = {
        id: "development",
        description: "local dev environment",
        toggleOnList: true,
        defaultState: true,
      };

      const result = addEnvironmentToOrganizationEnvironments(
        input,
        existingEnvironments
      );

      expect(result).toEqual([
        {
          id: "staging",
          description: "",
          toggleOnList: true,
          defaultState: true,
        },
        {
          id: "production",
          description: "My existing production environment",
          toggleOnList: false,
          defaultState: true,
        },
        {
          id: "development",
          description: "local dev environment",
          toggleOnList: true,
          defaultState: true,
        },
      ]);
    });

    describe("when the environment exists and should be replaced", () => {
      const input: Environment = {
        id: "production",
        description: "production environment imported from another service",
      };

      it("should replace the existing environment", () => {
        const result = addEnvironmentToOrganizationEnvironments(
          input,
          existingEnvironments,
          true
        );

        expect(result).toEqual([
          {
            id: "staging",
            description: "",
            toggleOnList: true,
            defaultState: true,
          },
          {
            id: "production",
            description: "production environment imported from another service",
          },
        ]);
      });
    });

    describe("when the environment exists and should not be replaced", () => {
      const input: Environment = {
        id: "production",
        description: "production environment imported from another service",
      };

      it("should not replace the existing environment", () => {
        const result = addEnvironmentToOrganizationEnvironments(
          input,
          existingEnvironments,
          false
        );

        expect(result).toEqual([
          {
            id: "staging",
            description: "",
            toggleOnList: true,
            defaultState: true,
          },
          {
            id: "production",
            description: "My existing production environment",
            toggleOnList: false,
            defaultState: true,
          },
        ]);
      });

      describe("when replace arg omitted", () => {
        it("should not replace the existing environment", () => {
          const result = addEnvironmentToOrganizationEnvironments(
            input,
            existingEnvironments
          );

          expect(result).toEqual([
            {
              id: "staging",
              description: "",
              toggleOnList: true,
              defaultState: true,
            },
            {
              id: "production",
              description: "My existing production environment",
              toggleOnList: false,
              defaultState: true,
            },
          ]);
        });
      });
    });
  });

  describe("containsEnvironment", () => {
    const existingEnvironments: Environment[] = [
      {
        id: "production",
        description: "My old production",
      },
      {
        id: "development",
        description: "My existing development environment",
      },
    ];

    beforeEach(() => {
      deepFreeze(existingEnvironments);
    });

    it("should return true when the environment by key already exists", () => {
      const input: Environment = {
        id: "production",
        description: "My new production",
      };

      const result = containsEnvironment(existingEnvironments, input);

      expect(result).toBe(true);
    });

    it("should return false when the environment does not exist", () => {
      const input: Environment = {
        id: "staging",
        description: "My staging environment",
      };

      const result = containsEnvironment(existingEnvironments, input);

      expect(result).toBe(false);
    });
  });
});
