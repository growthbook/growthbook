import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";
import {
  createOrganization,
  updateOrganization,
} from "back-end/src/models/OrganizationModel";
import { getOrganizationForRestRead } from "back-end/src/services/organizations";

jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  API_ORG_CACHE_MAX_AGE_MS: 60 * 60 * 1000,
}));

beforeAll(connectTestMongo);
afterAll(disconnectTestMongo);

// The org name carries a per-org version, so a read can be checked against
// the last write that finished before it started.
const versionOf = (name: string) => Number(name.split(":")[1]);

describe("getOrganizationForRestRead with the cache on", () => {
  it("never returns an org older than the last write before the read", async () => {
    const orgs = await Promise.all(
      Array.from({ length: 14 }, (_, i) =>
        createOrganization({
          email: `o${i}@example.com`,
          userId: `u_${i}`,
          name: "org:0",
        }),
      ),
    );
    const committed = new Map(orgs.map((o) => [o.id, 0]));
    const failures: string[] = [];

    const read = async (id: string) => {
      const atStart = committed.get(id) ?? 0;
      const org = await getOrganizationForRestRead(id);
      if (!org) failures.push(`${id}: null`);
      else if (org.id !== id) failures.push(`${id}: got ${org.id}`);
      else if (versionOf(org.name) < atStart) {
        failures.push(`${id}: ${org.name} < committed ${atStart}`);
      }
    };
    let next = 0;
    const write = async (id: string) => {
      const version = ++next;
      await updateOrganization(id, { name: `org:${version}` });
      // Writes to one org can finish out of order; keep the highest
      committed.set(id, Math.max(committed.get(id) ?? 0, version));
    };

    for (let round = 0; round < 20; round++) {
      const ops: Promise<void>[] = [];
      for (let i = 0; i < 40; i++) {
        const id = orgs[(round * 7 + i * 3) % orgs.length].id;
        ops.push(i % 5 === 0 ? write(id) : read(id));
      }
      await Promise.all(ops);
    }

    expect(failures).toEqual([]);
    // Every org is fresh once the dust settles
    for (const o of orgs) {
      const org = await getOrganizationForRestRead(o.id);
      expect(versionOf(org?.name ?? "")).toBe(committed.get(o.id));
    }
  });

  it("returns a frozen copy that later writes do not leak into", async () => {
    const created = await createOrganization({
      email: "f@example.com",
      userId: "u_f",
      name: "org:0",
    });
    const first = await getOrganizationForRestRead(created.id);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.settings)).toBe(true);
    expect(await getOrganizationForRestRead(created.id)).toBe(first);

    await updateOrganization(created.id, { name: "org:1" });
    const second = await getOrganizationForRestRead(created.id);
    expect(second).not.toBe(first);
    expect(second?.name).toBe("org:1");
    expect(first?.name).toBe("org:0");
  });
});
