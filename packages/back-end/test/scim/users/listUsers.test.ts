import { Response } from "express";
import { ExpandedMember } from "shared/types/organization";
import { listUsers } from "back-end/src/scim/users/listUsers";
import { expandOrgMembers } from "back-end/src/services/organizations";
import { ScimListRequest, ScimListResponse } from "back-end/types/scim";

jest.mock("back-end/src/services/organizations", () => ({
  expandOrgMembers: jest.fn(),
}));

const mockExpandOrgMembers = expandOrgMembers as jest.MockedFunction<
  typeof expandOrgMembers
>;

function makeExpandedMember(
  id: string,
  email: string,
  name: string,
): ExpandedMember {
  return {
    id,
    email,
    name,
    verified: true,
    role: "analyst",
    limitAccessByEnvironment: false,
    environments: [],
    managedByIdp: true,
  };
}

const BASE_MEMBERS: ExpandedMember[] = Array.from({ length: 25 }, (_, i) => {
  const n = i + 1;
  return makeExpandedMember(
    `user_${String(n).padStart(2, "0")}`,
    `user${n}@example.com`,
    `User ${n}`,
  );
});

function shuffled<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("SCIM listUsers pagination", () => {
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let req: Partial<ScimListRequest>;
  let res: Partial<Response<ScimListResponse>>;

  beforeEach(() => {
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    req = {
      query: {},
      organization: { id: "org_1", members: [] },
    };
    res = {
      status: mockStatus,
      json: mockJson,
    };
    jest.clearAllMocks();
  });

  async function getPage(
    startIndex: number,
    count: number,
  ): Promise<{ totalResults: number; Resources: { id: string }[] }> {
    req.query = {
      startIndex: String(startIndex),
      count: String(count),
    };
    await listUsers(req as ScimListRequest, res as Response<ScimListResponse>);
    const body = mockJson.mock.calls[mockJson.mock.calls.length - 1]?.[0];
    return {
      totalResults: body.totalResults,
      Resources: body.Resources ?? [],
    };
  }

  async function fullTraversal(
    count: number,
  ): Promise<{ ids: string[]; totalResults: number }> {
    const allIds: string[] = [];
    let totalResults: number | null = null;
    let startIndex = 1;

    while (true) {
      const page = await getPage(startIndex, count);
      if (totalResults === null) totalResults = page.totalResults;
      for (const r of page.Resources) allIds.push(r.id);
      if (allIds.length >= totalResults || page.Resources.length === 0) break;
      startIndex = allIds.length + 1;
    }

    return { ids: allIds, totalResults: totalResults ?? 0 };
  }

  it("returns same ordered list across traversals when expandOrgMembers order changes per request", async () => {
    let callIndex = 0;
    mockExpandOrgMembers.mockImplementation(async () => {
      callIndex++;
      if (callIndex % 2 === 1) {
        return [...BASE_MEMBERS].sort((a, b) => a.id.localeCompare(b.id));
      }
      return shuffled(BASE_MEMBERS);
    });

    const run1 = await fullTraversal(10);
    const run2 = await fullTraversal(10);

    expect(run1.ids.length).toBe(run1.totalResults);
    expect(run2.ids.length).toBe(run2.totalResults);
    expect(new Set(run1.ids).size).toBe(run1.ids.length);
    expect(new Set(run2.ids).size).toBe(run2.ids.length);
    expect(run1.ids).toEqual(run2.ids);
  });

  it("returns no duplicates and complete set in a single traversal", async () => {
    mockExpandOrgMembers.mockResolvedValue(shuffled(BASE_MEMBERS));

    const { ids, totalResults } = await fullTraversal(10);

    expect(ids.length).toBe(totalResults);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
