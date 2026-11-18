import { EventForwarderConfigInterface } from "shared/validators";
import { setEventForwarderEnvironments } from "back-end/src/services/eventForwarder/config";

const row = (
  id: string,
  overrides: Partial<EventForwarderConfigInterface> = {},
): EventForwarderConfigInterface =>
  ({ id, status: "ready", connectorName: "c", ...overrides }) as never;

// `stored` is what the guarded write re-reads; defaults to the row passed in
function mockContext(
  others: EventForwarderConfigInterface[],
  stored?: EventForwarderConfigInterface,
) {
  const updateWithCas = jest.fn(async (id, _guard, compute) => {
    const fresh = stored ?? row(id);
    return { ...fresh, ...(await compute(fresh)) };
  });
  return {
    updateWithCas,
    context: {
      org: {
        settings: {
          environments: [{ id: "production" }, { id: "dev" }],
        },
      },
      models: {
        eventForwarderConfigs: {
          updateWithCas,
          getAllBypassingReadPermissions: async () => others,
        },
      },
    } as never,
  };
}

describe("setEventForwarderEnvironments", () => {
  it("narrows a live forwarder from all environments", async () => {
    const current = row("a");
    const { context, updateWithCas } = mockContext([current], current);
    const updated = await setEventForwarderEnvironments(context, current, [
      "dev",
    ]);
    expect(updated.environments).toEqual(["dev"]);
    expect(updateWithCas.mock.calls[0][1]).toEqual(["environments", "status"]);
  });

  it("keeps the lock on a live forwarder that has an environment", async () => {
    const current = row("a", { environments: ["production"] });
    const { context } = mockContext([current], current);
    await expect(
      setEventForwarderEnvironments(context, current, ["dev"]),
    ).rejects.toThrow(/cannot be changed/);
  });

  it("rejects an environment another forwarder in the region holds", async () => {
    const current = row("a");
    const { context } = mockContext([
      current,
      row("b", { environments: ["dev"] }),
    ]);
    await expect(
      setEventForwarderEnvironments(context, current, ["dev"]),
    ).rejects.toThrow(/already receives/);
  });

  it("rechecks the lock against a binding saved after the read", async () => {
    const current = row("a");
    const { context } = mockContext(
      [current],
      row("a", { environments: ["production"] }),
    );
    await expect(
      setEventForwarderEnvironments(context, current, ["dev"]),
    ).rejects.toThrow(/cannot be changed/);
  });
});
