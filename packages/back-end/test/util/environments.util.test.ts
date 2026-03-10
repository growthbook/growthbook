import { Environment } from "shared/types/organization";
import { deepFreeze } from "back-end/test/test-helpers";
import { addEnvironmentToOrganizationEnvironments } from "back-end/src/util/environments";
import { Context } from "back-end/src/models/BaseModel";

const auditLogMock = jest.fn();

const context = {
  org: { id: "a" },
  auditLog: auditLogMock,
  permissions: {
    canCreateEnvironment: () => true,
    canUpdateEnvironment: () => true,
  },
} as unknown as Context;

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
        context,
        input,
        existingEnvironments,
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
          context,
          input,
          existingEnvironments,
          true,
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
          context,
          input,
          existingEnvironments,
          false,
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
            context,
            input,
            existingEnvironments,
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
});
