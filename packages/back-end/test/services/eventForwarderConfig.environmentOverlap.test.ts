import { EventForwarderConfigInterface } from "shared/validators";
import { assertNoEventForwarderEnvironmentOverlap } from "back-end/src/services/eventForwarder/config";

type Row = Partial<EventForwarderConfigInterface>;

const row = (id: string, overrides: Row = {}): EventForwarderConfigInterface =>
  ({ id, status: "ready", connectorName: "c", ...overrides }) as never;

function check(
  rows: EventForwarderConfigInterface[],
  environment: string | undefined,
  options?: Parameters<typeof assertNoEventForwarderEnvironmentOverlap>[2],
) {
  const context = {
    org: {
      settings: {
        environments: [{ id: "production" }, { id: "staging" }, { id: "dev" }],
      },
    },
    models: {
      eventForwarderConfigs: {
        getAllBypassingReadPermissions: async () => rows,
      },
    },
  } as never;
  return assertNoEventForwarderEnvironmentOverlap(
    context,
    environment,
    options,
  );
}

describe("assertNoEventForwarderEnvironmentOverlap", () => {
  it("allows the first forwarder with or without an environment", async () => {
    await expect(check([], undefined)).resolves.toBeUndefined();
    await expect(check([], "production")).resolves.toBeUndefined();
  });

  it("allows one forwarder per environment", async () => {
    const rows = [row("a", { environment: "production" })];
    await expect(check(rows, "staging")).resolves.toBeUndefined();
    await expect(check(rows, "production")).rejects.toThrow(/already receives/);
  });

  it("rejects a new forwarder with no environment, or beside one that receives all", async () => {
    await expect(
      check([row("a", { environment: "production" })], undefined),
    ).rejects.toThrow(/Choose an environment/);
    await expect(check([row("a")], "staging")).rejects.toThrow(
      /receives all environments/,
    );
  });

  it("rejects an unknown environment", async () => {
    await expect(check([], "nope")).rejects.toThrow(/Cannot find environment/);
  });

  it("ignores the row being updated and rows that never received events", async () => {
    const current = row("a", { environment: "production" });
    const rows = [
      current,
      row("b", { status: "unconfigured" }),
      row("c", { status: "error", connectorName: "" }),
    ];
    await expect(
      check(rows, "production", { current }),
    ).resolves.toBeUndefined();
    await expect(check(rows, "production")).rejects.toThrow(/already receives/);
  });

  it("lets legacy forwarders that both receive everything be bound one at a time, but not widened back", async () => {
    const a = row("a");
    const b = row("b");
    await expect(
      check([a, b], "production", { current: a }),
    ).resolves.toBeUndefined();
    const bound = row("a", { environment: "production" });
    await expect(
      check([bound, b], undefined, { current: bound }),
    ).rejects.toThrow(/Choose an environment/);
  });

  it("only blocks an unconfigured forwarder up front when another receives everything", async () => {
    await expect(
      check([row("a", { environment: "production" })], undefined, {
        allowUnset: true,
      }),
    ).resolves.toBeUndefined();
    await expect(
      check([row("a")], undefined, { allowUnset: true }),
    ).rejects.toThrow(/receives all environments/);
  });
});
