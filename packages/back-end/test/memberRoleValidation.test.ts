import { OrganizationInterface } from "shared/types/organization";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { assertMemberRoleInfoValid } from "back-end/src/services/organizations";

jest.mock("back-end/src/enterprise", () => ({
  ...jest.requireActual("back-end/src/enterprise"),
  orgHasPremiumFeature: jest.fn(),
}));

const mockPremium = orgHasPremiumFeature as jest.MockedFunction<
  typeof orgHasPremiumFeature
>;

const org = {
  id: "org_1",
  settings: {
    environments: [{ id: "dev" }, { id: "production" }],
  },
  customRoles: [
    // Env-scoped policies, so the role supports environment limits.
    { id: "qa_publisher", description: "", policies: ["FlagsPublish"] },
    // Nothing env-scoped, so an environment limit on it is meaningless.
    { id: "qa_drafter", description: "", policies: ["FlagsEditDrafts"] },
  ],
} as unknown as OrganizationInterface;

const valid = (info: Parameters<typeof assertMemberRoleInfoValid>[1]) =>
  assertMemberRoleInfoValid(org, info);

beforeEach(() => {
  mockPremium.mockReturnValue(true);
});

describe("assertMemberRoleInfoValid", () => {
  // Every rule slot fails the same way for the same defect: base, additional,
  // project override, and an additional rule nested in a project override.
  const slots: [
    string,
    (rule: {
      role: string;
      limitAccessByEnvironment?: boolean;
      environments?: string[];
    }) => Parameters<typeof assertMemberRoleInfoValid>[1],
  ][] = [
    ["base rule", (rule) => rule],
    [
      "additional rule",
      (rule) => ({ role: "engineer", additionalRoles: [rule] }),
    ],
    [
      "project override",
      (rule) => ({
        role: "engineer",
        projectRoles: [{ ...rule, project: "prj_a" }],
      }),
    ],
    [
      "additional rule inside a project override",
      (rule) => ({
        role: "engineer",
        projectRoles: [
          { role: "engineer", project: "prj_a", additionalRoles: [rule] },
        ],
      }),
    ],
  ];

  const defects: [string, Parameters<(typeof slots)[0][1]>[0], RegExp][] = [
    ["an unknown role", { role: "not_a_role" }, /not a valid role/],
    [
      "an unknown environment",
      {
        role: "qa_publisher",
        limitAccessByEnvironment: true,
        environments: ["nope"],
      },
      /not a valid environment/,
    ],
    [
      "an environment limit on a role with nothing env-scoped",
      {
        role: "qa_drafter",
        limitAccessByEnvironment: true,
        environments: ["dev"],
      },
      /does not support restricting/,
    ],
  ];

  describe.each(slots)("%s", (_slot, wrap) => {
    it.each(defects)("rejects %s", (_defect, rule, message) => {
      expect(() => valid(wrap(rule))).toThrow(message);
    });

    it("accepts a valid env-limited rule", () => {
      expect(() =>
        valid(
          wrap({
            role: "qa_publisher",
            limitAccessByEnvironment: true,
            environments: ["production"],
          }),
        ),
      ).not.toThrow();
    });
  });

  it("accepts the full shape at once", () => {
    expect(() =>
      valid({
        role: "engineer",
        additionalRoles: [{ role: "qa_publisher", environments: ["dev"] }],
        projectRoles: [
          {
            project: "prj_a",
            role: "qa_drafter",
            additionalRoles: [
              { role: "qa_publisher", environments: ["production"] },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects duplicate project overrides", () => {
    expect(() =>
      valid({
        role: "engineer",
        projectRoles: [
          { project: "prj_a", role: "engineer" },
          { project: "prj_a", role: "qa_publisher" },
        ],
      }),
    ).toThrow(/Only one rule per project/);
  });

  // An additional rule's environment list IS its limit; the flag is derived
  // when the caller does not send one.
  it("treats an extra rule's env list as its limit even without the flag", () => {
    expect(() =>
      valid({
        role: "engineer",
        additionalRoles: [{ role: "qa_publisher", environments: ["nope"] }],
      }),
    ).toThrow(/not a valid environment/);
  });

  describe("plan gates", () => {
    beforeEach(() => {
      mockPremium.mockReturnValue(false);
    });

    it.each([
      ["noaccess", { role: "noaccess" }, /no-access role/],
      [
        "project admin",
        { role: "gbDefault_projectAdmin" },
        /project admin role/,
      ],
      [
        "environment limits",
        {
          role: "qa_publisher",
          limitAccessByEnvironment: true,
          environments: ["dev"],
        },
        /restrict permissions by environment/,
      ],
    ])("gates %s", (_name, rule, message) => {
      expect(() => valid(rule)).toThrow(message);
    });

    it("gates project overrides entirely", () => {
      expect(() =>
        valid({
          role: "engineer",
          projectRoles: [{ project: "prj_a", role: "engineer" }],
        }),
      ).toThrow(/project-level permissions/);
    });

    it("still accepts a plain role", () => {
      expect(() => valid({ role: "engineer" })).not.toThrow();
    });
  });
});
