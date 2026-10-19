import type { ContextualBanditInterface } from "shared/validators";
import type { VisualChangesetInterface } from "shared/types/visual-changeset";
import type { ApiReqContext } from "back-end/types/api";
import {
  diffVisualChangesWithArms,
  onContextualBanditVisualStateChanged,
} from "back-end/src/services/contextualBanditVisualState";
import {
  alignVisualChangesetArms,
  findVisualChangesetsByContextualBandit,
} from "back-end/src/models/VisualChangesetModel";
import { activatePendingContextualBanditVariations } from "back-end/src/enterprise/services/contextualBandits";
import { refreshLinkedFeaturePayloads } from "back-end/src/services/contextualBanditChanges";

jest.mock("back-end/src/models/VisualChangesetModel", () => ({
  findVisualChangesetsByContextualBandit: jest.fn(),
  alignVisualChangesetArms: jest.fn(),
  genNewVisualChange: ({ id }: { id: string }) => ({
    id: `vc_new_${id}`,
    variation: id,
    description: "",
    css: "",
    domMutations: [],
  }),
}));
jest.mock("back-end/src/enterprise/services/contextualBandits", () => ({
  activatePendingContextualBanditVariations: jest.fn(),
}));
jest.mock("back-end/src/services/contextualBanditChanges", () => ({
  refreshLinkedFeaturePayloads: jest.fn(),
}));

const mockFindChangesets = jest.mocked(findVisualChangesetsByContextualBandit);
const mockAlign = jest.mocked(alignVisualChangesetArms);
const mockActivate = jest.mocked(activatePendingContextualBanditVariations);
const mockRefresh = jest.mocked(refreshLinkedFeaturePayloads);
const mockGetById = jest.fn();

type VisualChange = VisualChangesetInterface["visualChanges"][number];
type Arm = ContextualBanditInterface["variations"][number];

const arm = (id: string, status?: Arm["status"]): Arm =>
  ({
    id,
    key: id,
    name: id,
    description: "",
    screenshots: [],
    ...(status ? { status } : {}),
  }) as Arm;

const change = (variation: string, css = ""): VisualChange => ({
  id: `vc_${variation}`,
  variation,
  description: "",
  css,
  domMutations: [],
});

const empty = (variation: string): VisualChange => ({
  ...change(variation),
  id: `vc_new_${variation}`,
});

function makeCb(
  overrides: Partial<ContextualBanditInterface> = {},
): ContextualBanditInterface {
  return {
    id: "cb_1",
    organization: "org_1",
    status: "running",
    archived: false,
    hasVisualChangesets: true,
    variations: [arm("v0"), arm("v1")],
    ...overrides,
  } as unknown as ContextualBanditInterface;
}

function changeset(visualChanges: VisualChange[]): VisualChangesetInterface {
  return {
    id: "vcs_1",
    organization: "org_1",
    contextualBandit: "cb_1",
    urlPatterns: [],
    editorUrl: "https://example.com",
    visualChanges,
  } as unknown as VisualChangesetInterface;
}

const context = {
  org: { id: "org_1" },
  models: { contextualBandits: { getById: mockGetById } },
} as unknown as ApiReqContext;

beforeEach(() => {
  jest.clearAllMocks();
  mockActivate.mockImplementation(async (_ctx, cb) => ({
    activatedIds: [],
    updated: cb,
  }));
});

describe("diffVisualChangesWithArms", () => {
  it("returns null when every visible arm already has its entry", () => {
    expect(
      diffVisualChangesWithArms(
        [change("v0"), change("v1", ".a{}")],
        [arm("v0"), arm("v1")],
        empty,
      ),
    ).toBeNull();
  });

  it("adds empty entries for visible arms in arm order", () => {
    expect(
      diffVisualChangesWithArms(
        [change("v1", ".a{}")],
        [arm("v0"), arm("v1"), arm("v2", "pending")],
        empty,
      ),
    ).toEqual({ add: [empty("v0"), empty("v2")], removeVariationIds: [] });
  });

  it("removes entries for deactivated arms", () => {
    expect(
      diffVisualChangesWithArms(
        [change("v0"), change("v1", ".a{}"), change("v2", ".b{}")],
        [arm("v0"), arm("v1", "deactivated"), arm("v2")],
        empty,
      ),
    ).toEqual({ add: [], removeVariationIds: ["v1"] });
  });

  it("leaves an arm the bandit copy does not know yet alone", () => {
    expect(
      diffVisualChangesWithArms(
        [change("v0"), change("v1"), change("v_new", "h2 { color: red; }")],
        [arm("v0"), arm("v1"), arm("v2", "pending")],
        empty,
      ),
    ).toEqual({ add: [empty("v2")], removeVariationIds: [] });
  });

  it("never touches entries for arms that stay", () => {
    const diff = diffVisualChangesWithArms(
      [change("v0", ".keep{}"), change("v1", ".keep{}")],
      [arm("v0"), arm("v1", "deactivated"), arm("v2", "pending")],
      empty,
    );
    expect(diff?.add.map((vc) => vc.variation)).toEqual(["v2"]);
    expect(diff?.removeVariationIds).toEqual(["v1"]);
  });
});

describe("onContextualBanditVisualStateChanged", () => {
  it("syncs against a fresh read of the bandit, not the caller's copy", async () => {
    const stale = makeCb();
    const fresh = makeCb({
      variations: [arm("v0"), arm("v1"), arm("v2", "pending")],
    });
    mockGetById.mockResolvedValue(fresh);
    mockFindChangesets.mockResolvedValue([
      changeset([
        change("v0"),
        change("v1"),
        change("v2", "h2 { color: red; }"),
      ]),
    ]);

    const result = await onContextualBanditVisualStateChanged(context, stale);

    expect(mockGetById).toHaveBeenCalledWith("cb_1");
    expect(mockAlign).not.toHaveBeenCalled();
    expect(mockActivate).toHaveBeenCalledWith(context, fresh, {
      bypassPermissionChecks: true,
    });
    expect(mockRefresh).toHaveBeenCalledWith(
      context,
      fresh,
      "contextualBandit.refresh",
    );
    expect(result).toBe(fresh);
  });

  it("aligns only changesets that need new entries", async () => {
    const cb = makeCb({
      variations: [arm("v0"), arm("v1"), arm("v2", "pending")],
    });
    mockGetById.mockResolvedValue(cb);
    const aligned = changeset([change("v0"), change("v1"), change("v2")]);
    const missing = { ...changeset([change("v0"), change("v1")]), id: "vcs_2" };
    mockFindChangesets.mockResolvedValue([aligned, missing]);

    await onContextualBanditVisualStateChanged(context, cb);

    expect(mockAlign).toHaveBeenCalledTimes(1);
    expect(mockAlign).toHaveBeenCalledWith(context, "vcs_2", {
      add: [empty("v2")],
      removeVariationIds: [],
    });
  });

  it("only refreshes payloads for a bandit without visual changesets", async () => {
    const cb = makeCb({ hasVisualChangesets: false });
    mockGetById.mockResolvedValue(cb);

    await onContextualBanditVisualStateChanged(context, cb);

    expect(mockFindChangesets).not.toHaveBeenCalled();
    expect(mockActivate).not.toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalledWith(
      context,
      cb,
      "contextualBandit.refresh",
    );
  });

  it("syncs and activates arms after the last changeset is deleted", async () => {
    const cb = makeCb({
      hasVisualChangesets: false,
      variations: [arm("v0"), arm("v1"), arm("v2", "pending")],
    });
    mockGetById.mockResolvedValue(cb);
    mockFindChangesets.mockResolvedValue([]);

    await onContextualBanditVisualStateChanged(context, cb, {
      changesetDeleted: true,
    });

    expect(mockFindChangesets).toHaveBeenCalledWith("cb_1", "org_1");
    expect(mockActivate).toHaveBeenCalledWith(context, cb, {
      bypassPermissionChecks: true,
    });
    expect(mockRefresh).toHaveBeenCalledWith(
      context,
      cb,
      "contextualBandit.refresh",
    );
  });

  it("falls back to the caller's copy when the bandit cannot be re-read", async () => {
    const cb = makeCb({ hasVisualChangesets: false });
    mockGetById.mockResolvedValue(null);

    expect(await onContextualBanditVisualStateChanged(context, cb)).toBe(cb);
  });
});
