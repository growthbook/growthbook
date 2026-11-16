import { EventForwarderConfigInterface } from "shared/validators";
import {
  assertEventForwarderEnvironmentUnchanged,
  assertNoEventForwarderEnvironmentOverlap,
  getClaimedEventForwarderEnvironments,
} from "back-end/src/services/eventForwarder/config";

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

  it("lets a lone forwarder go back to all environments", async () => {
    const current = row("a", { environment: "production" });
    await expect(
      check([current], undefined, { current }),
    ).resolves.toBeUndefined();
  });

  it("lets a forwarder that already receives all environments keep them", async () => {
    const current = row("a");
    await expect(
      check([current], undefined, { current }),
    ).resolves.toBeUndefined();
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

  it("still rejects an environment held by a row that never received events (unique index)", async () => {
    const rows = [
      row("a", { status: "error", connectorName: "", environment: "dev" }),
    ];
    await expect(check(rows, "dev")).rejects.toThrow(/already receives/);
    await expect(check(rows, "staging")).resolves.toBeUndefined();
  });

  it("applies the rules per data region, with absent as us-east-1", async () => {
    const rows = [
      row("a"),
      row("b", { environment: "dev", region: "eu-west-1" }),
    ];
    // Same environment, or all environments, in the other region
    await expect(
      check([rows[1]], "dev", { region: "us-east-1" }),
    ).resolves.toBeUndefined();
    await expect(
      check([rows[1]], undefined, { region: "us-east-1" }),
    ).resolves.toBeUndefined();
    // Same region still conflicts
    await expect(check(rows, "dev", { region: "eu-west-1" })).rejects.toThrow(
      /already receives/,
    );
    await expect(check(rows, "dev", { region: "us-east-1" })).rejects.toThrow(
      /receives all environments/,
    );
    // An update is checked in its own row's region
    const current = row("c", { environment: "staging", region: "eu-west-1" });
    await expect(check(rows, "dev", { current })).rejects.toThrow(
      /already receives/,
    );
  });
});

describe("getClaimedEventForwarderEnvironments", () => {
  it("lists bound rows and live unbound ones, and skips unbound rows that never received events", () => {
    expect(
      getClaimedEventForwarderEnvironments([
        row("a", { datasourceId: "ds_a", environment: "production" }),
        row("b", { datasourceId: "ds_b" }),
        row("c", { datasourceId: "ds_c", status: "unconfigured" }),
        row("d", {
          datasourceId: "ds_d",
          status: "error",
          connectorName: "",
          environment: "dev",
        }),
      ]),
    ).toEqual([
      { datasourceId: "ds_a", environment: "production", region: "us-east-1" },
      { datasourceId: "ds_b", environment: "", region: "us-east-1" },
      { datasourceId: "ds_d", environment: "dev", region: "us-east-1" },
    ]);
  });
});

describe("assertEventForwarderEnvironmentUnchanged", () => {
  const context = {
    org: { settings: { environments: [{ id: "production" }, { id: "dev" }] } },
  } as never;
  const change = (existing: EventForwarderConfigInterface, to?: string) => () =>
    assertEventForwarderEnvironmentUnchanged(context, existing, to);

  it("rejects moving a live forwarder to another environment or back to all", () => {
    const live = row("a", { environment: "production" });
    expect(change(live, "dev")).toThrow(/cannot be changed/);
    expect(change(live, undefined)).toThrow(/cannot be changed/);
    expect(change(live, "production")).not.toThrow();
  });

  it("allows narrowing from all, rows that never received events, and deleted environments", () => {
    expect(change(row("a"), "dev")).not.toThrow();
    expect(
      change(
        row("a", { environment: "dev", status: "unconfigured" }),
        "production",
      ),
    ).not.toThrow();
    expect(change(row("a", { environment: "gone" }), "dev")).not.toThrow();
  });
});
