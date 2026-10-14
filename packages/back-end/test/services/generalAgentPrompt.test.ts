import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generalAgentConfig } from "back-end/src/agent/general-agent";
import { listDomainSkills } from "back-end/src/agent/skills";
import { ReqContextClass } from "back-end/src/services/context";

jest.mock("back-end/src/api/api.router", () => ({ allRoutes: [] }));
jest.mock("back-end/src/services/context");
jest.mock("back-end/src/enterprise/services/agent-handler", () => ({
  createAgentHandler: () => async () => undefined,
}));
jest.mock("back-end/src/enterprise/services/ai", () => ({
  aiTool: (definition: unknown) => definition,
}));
jest.mock("back-end/src/agent/skills", () => ({
  listDomainSkills: jest.fn(() => [
    { name: "feature-flags", description: "Manage Feature Flags." },
    { name: "experiments", description: "Analyze experiments." },
  ]),
  readSkill: jest.fn(),
}));

const context = new ReqContextClass({
  org: {
    id: "org1",
    name: "Organization",
    url: "",
    ownerEmail: "owner@example.com",
    dateCreated: new Date(),
    members: [],
    invites: [],
    settings: {},
  },
  auditUser: { type: "api_key", apiKey: "test" },
  role: "admin",
});

// Captured from 51c70d074a before splitting the web and Slack prompts.
const expectedPrompt = readFileSync(
  join(__dirname, "../fixtures/agent/general-system-prompt.txt"),
  "utf8",
);

it("preserves the complete web prompt byte for byte", async () => {
  expect(await generalAgentConfig.buildSystemPrompt(context, {})).toBe(
    expectedPrompt,
  );
});

it("omits the skills index when no domains are available", async () => {
  jest.mocked(listDomainSkills).mockReturnValueOnce([]);
  expect(await generalAgentConfig.buildSystemPrompt(context, {})).toBe(
    expectedPrompt.split("\n\n# Available skills")[0],
  );
});
