import { matchConfirmRules, routeConfirmation } from "shared/util";
import {
  holdAtRoute,
  plainWriteSummary,
} from "back-end/src/services/confirmations";
import { visualChangesetsRoutes } from "back-end/src/api/visual-changesets/visual-changesets.router";
import { visualEditorAiRoutes } from "back-end/src/api/visual-editor-ai/visualEditorAi.router";
import type { ReqContext } from "back-end/types/request";

// Without an API key to hold the request for, a matching rule refuses instead,
// so a rejection means the request would have been held.
const hold = (req: { query?: unknown; body?: unknown }) =>
  holdAtRoute(
    {
      isApiRequest: true,
      org: { settings: {} },
      apiKeyData: { confirmRules: [{ actions: ["override.*"] }] },
      models: {},
      req,
    } as unknown as ReqContext,
    [],
    undefined,
    "post",
    "/features/:id",
    req,
  );

describe("holdAtRoute", () => {
  it("holds a skip asked for in the query or the body, except on a dry run", async () => {
    await expect(
      hold({ query: { skipHooks: "yes" }, body: { skipHooks: false } }),
    ).rejects.toThrow("only a direct API request");
    await expect(
      hold({ body: { skipSchemaValidation: true } }),
    ).rejects.toThrow("only a direct API request");
    await expect(hold({ query: { skipHooks: "no" } })).resolves.toBeUndefined();
    await expect(
      hold({ body: { dryRun: true, skipHooks: true } }),
    ).resolves.toBeUndefined();
  });
});

describe("plainWriteSummary", () => {
  it("names a plain write's target and the fields it sets", () => {
    expect(
      plainWriteSummary("put", "/projects/:id", "project", "Checkout", {
        name: "Checkout",
        defaultState: true,
        ignoreWarnings: true,
      }),
    ).toBe("Update project Checkout: name, default state");
    expect(
      plainWriteSummary("post", "/projects", "project", "Checkout", {}),
    ).toBe("Create project Checkout");
    expect(
      plainWriteSummary("delete", "/projects/:id", "project", "Checkout", {}),
    ).toBe("Delete project Checkout");
  });

  it("leaves other route shapes to their own summaries", () => {
    expect(
      plainWriteSummary("post", "/teams/:id/members", "team", "Core", {}),
    ).toBeNull();
    expect(
      plainWriteSummary("put", "/settings/approvals", "settings", "", {}),
    ).toBeNull();
  });
});

// Every write the visual editor extension makes. A person is at the editor,
// so the recommended rule leaves them alone.
const EXTENSION_WRITES = [
  "put /visual-changesets/:id",
  "post /visual-editor/add-variant",
  "post /visual-editor/delete-variant",
  "post /visual-editor/rename-variant",
  "post /visual-editor/rename-experiment",
  "post /visual-editor/create-changeset",
  "post /visual-editor/create-experiment",
  "post /visual-editor/ai/edit",
  "post /visual-editor/ai/edit/resume",
  "post /visual-editor/ai/suggestions",
  "post /visual-editor/ai/figma-to-variant",
  "post /visual-editor/ai/image-gen",
  "post /visual-editor/ai/promote-image",
  "post /visual-editor/ai/upload-signed-url",
  "post /visual-editor/figma/oauth/exchange",
  "post /visual-editor/figma/disconnect",
];

describe("the visual editor extension", () => {
  it("isn't held by the recommended rule", () => {
    const routes = new Map(
      [...visualChangesetsRoutes, ...visualEditorAiRoutes].map((route) => [
        `${route.method} ${route.path}`,
        route,
      ]),
    );
    for (const write of EXTENSION_WRITES) {
      const route = routes.get(write);
      if (!route) throw new Error(`No route for ${write}`);
      const actions = routeConfirmation(
        route.method,
        route.tags,
        route.confirmation,
      ).map((action) => ({ action, environments: [] }));
      expect([
        write,
        matchConfirmRules([{ actions: ["recommended"] }], actions),
      ]).toEqual([write, []]);
    }
  });
});
