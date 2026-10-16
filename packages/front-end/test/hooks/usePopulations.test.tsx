import { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { populationEndpoints } from "shared/api-endpoints";
import { ApiPopulation } from "shared/validators";
import { usePopulations } from "@/hooks/usePopulations";
import { useAuth } from "@/services/auth";
import { useRestApiCall } from "@/services/restApi";

vi.mock("@/services/auth", () => ({ useAuth: vi.fn() }));
vi.mock("@/services/restApi", () => ({
  useRestApiCall: vi.fn(),
  useRestApi: vi.fn(),
}));

function population(id: string, projects: string[] = []): ApiPopulation {
  return { id, projects } as ApiPopulation;
}

function page(
  populations: ApiPopulation[],
  {
    hasMore,
    nextOffset,
    offset = 0,
  }: { hasMore: boolean; nextOffset: number | null; offset?: number },
) {
  return {
    populations,
    limit: 100,
    offset,
    count: populations.length,
    total: populations.length,
    hasMore,
    nextOffset,
  };
}

describe("usePopulations", () => {
  const restApiCall = vi.fn();

  beforeEach(() => {
    restApiCall.mockReset();
    vi.mocked(useRestApiCall).mockReturnValue(
      restApiCall as ReturnType<typeof useRestApiCall>,
    );
    vi.mocked(useAuth).mockReturnValue({
      orgId: "org_1",
    } as unknown as ReturnType<typeof useAuth>);
  });

  function render({
    project,
    enabled = true,
  }: { project?: string; enabled?: boolean } = {}) {
    return renderHook(
      (props: { project?: string; enabled: boolean }) =>
        usePopulations(props.project, { enabled: props.enabled }),
      {
        initialProps: { project, enabled },
        wrapper: ({ children }: { children: ReactNode }) => (
          <SWRConfig
            value={{
              provider: () => new Map(),
              dedupingInterval: 0,
              shouldRetryOnError: false,
              revalidateOnFocus: false,
            }}
          >
            {children}
          </SWRConfig>
        ),
      },
    );
  }

  it("does not fetch when disabled", () => {
    const { result } = render({ enabled: false });

    expect(result.current.loading).toBe(false);
    expect(result.current.populations).toEqual([]);
    expect(restApiCall).not.toHaveBeenCalled();
  });

  it("does not fetch without an organization", () => {
    vi.mocked(useAuth).mockReturnValue({
      orgId: "",
    } as unknown as ReturnType<typeof useAuth>);

    const { result } = render();

    expect(result.current.loading).toBe(false);
    expect(restApiCall).not.toHaveBeenCalled();
  });

  it("follows nextOffset and concatenates every page", async () => {
    restApiCall.mockImplementation(
      async (_endpoint: unknown, args: { query: { offset: number } }) => {
        if (args.query.offset === 0) {
          return page([population("pop_1")], {
            hasMore: true,
            nextOffset: 100,
          });
        }
        if (args.query.offset === 100) {
          return page([population("pop_2")], {
            hasMore: false,
            nextOffset: null,
            offset: 100,
          });
        }
        throw new Error(`unexpected offset ${args.query.offset}`);
      },
    );

    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.populations.map((p) => p.id)).toEqual([
      "pop_1",
      "pop_2",
    ]);
    expect(restApiCall).toHaveBeenNthCalledWith(
      1,
      populationEndpoints.listPopulations,
      { query: { limit: 100, offset: 0 } },
    );
    expect(restApiCall).toHaveBeenNthCalledWith(
      2,
      populationEndpoints.listPopulations,
      { query: { limit: 100, offset: 100 } },
    );
    expect(restApiCall).toHaveBeenCalledTimes(2);
  });

  it("stops when the next offset is missing", async () => {
    restApiCall.mockResolvedValue(
      page([population("pop_1")], { hasMore: true, nextOffset: null }),
    );

    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.populations.map((p) => p.id)).toEqual(["pop_1"]);
    expect(restApiCall).toHaveBeenCalledTimes(1);
  });

  it("stops when the next offset does not move forward", async () => {
    let calls = 0;
    restApiCall.mockImplementation(async () => {
      calls += 1;
      if (calls > 2) throw new Error("kept requesting pages");
      return page([population("pop_1")], { hasMore: true, nextOffset: 0 });
    });

    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeUndefined();
    expect(result.current.populations.map((p) => p.id)).toEqual(["pop_1"]);
    expect(restApiCall).toHaveBeenCalledTimes(1);
  });

  it("keeps populations that apply to the selected project", async () => {
    restApiCall.mockResolvedValue(
      page(
        [
          population("pop_all", []),
          population("pop_a", ["prj_a"]),
          population("pop_b", ["prj_b"]),
        ],
        { hasMore: false, nextOffset: null },
      ),
    );

    const { result, rerender } = render({ project: "prj_a" });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.populations.map((p) => p.id)).toEqual([
      "pop_all",
      "pop_a",
    ]);

    rerender({ project: undefined, enabled: true });
    expect(result.current.populations.map((p) => p.id)).toEqual([
      "pop_all",
      "pop_a",
      "pop_b",
    ]);
    expect(restApiCall).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed request", async () => {
    restApiCall.mockRejectedValue(new Error("nope"));

    const { result } = render();

    await waitFor(() => expect(result.current.error?.message).toBe("nope"));
    expect(result.current.loading).toBe(false);
    expect(result.current.populations).toEqual([]);
  });
});
