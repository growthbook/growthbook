import { EventUser } from "shared/types/events/event-types";
import {
  ApiRateLimitSettings,
  getApiRateLimitBucket,
} from "back-end/src/util/apiRateLimit";

const defaults: ApiRateLimitSettings = {
  max: 60,
  maxByKey: new Map(),
  separateWrites: false,
  separateRequesters: false,
};

const namingDana: EventUser = {
  type: "api_key",
  apiKey: "key_a",
  name: "Gateway",
  requestedBy: { id: "u_dana", name: "Dana", email: "dana@example.com" },
};

function bucket(
  method: string,
  settings: Partial<ApiRateLimitSettings> = {},
  { apiKey = "key_a", eventAudit = namingDana } = {},
) {
  return getApiRateLimitBucket(
    { apiKey, method, eventAudit },
    { ...defaults, ...settings },
  );
}

describe("getApiRateLimitBucket", () => {
  it("counts every request against its key by default, even one naming a requester", () => {
    expect(bucket("GET")).toEqual({ key: "key_a", max: 60, writes: false });
    expect(bucket("POST")).toEqual({ key: "key_a", max: 60, writes: false });
  });

  it("applies a key's own limit, above or below the default", () => {
    const maxByKey = new Map([
      ["key_a", 500],
      ["key_b", 10],
    ]);
    expect(bucket("GET", { maxByKey }).max).toBe(500);
    expect(bucket("GET", { maxByKey }, { apiKey: "key_b" }).max).toBe(10);
    expect(bucket("GET", { maxByKey }, { apiKey: "key_c" }).max).toBe(60);
  });

  it("separates writes at the key's limit, leaving GET, HEAD and OPTIONS as reads", () => {
    const settings = {
      separateWrites: true,
      maxByKey: new Map([["key_a", 500]]),
    };
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(bucket(method, settings)).toEqual({
        key: "key_a:writes",
        max: 500,
        writes: true,
      });
    }
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(bucket(method, settings).key).toBe("key_a");
    }
  });

  it("gives each named requester their own counts when requesters are separated", () => {
    const settings = { separateRequesters: true, separateWrites: true };
    expect(bucket("GET", settings).key).toBe("key_a:u_dana");
    expect(bucket("POST", settings).key).toBe("key_a:u_dana:writes");

    const keyAlone: EventUser = { type: "api_key", apiKey: "key_a" };
    expect(bucket("GET", settings, { eventAudit: keyAlone }).key).toBe("key_a");
  });
});
