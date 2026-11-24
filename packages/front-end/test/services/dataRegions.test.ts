import {
  eventForwarderRegionsFor,
  eventIngestorRegionFor,
} from "@/services/dataRegions";

describe("eventForwarderRegionsFor", () => {
  const claims = [
    { environment: "production", region: "us-east-1" as const },
    { environment: "dev", region: "eu-west-1" as const },
  ];

  it("finds the region of the forwarder holding the environment", () => {
    expect(eventForwarderRegionsFor(claims, "production")).toEqual([
      "us-east-1",
    ]);
    expect(eventForwarderRegionsFor(claims, "staging")).toEqual([]);
  });

  it("counts a forwarder that receives all environments", () => {
    expect(
      eventForwarderRegionsFor(
        [...claims, { environment: "", region: "eu-west-1" }],
        "production",
      ),
    ).toEqual(["us-east-1", "eu-west-1"]);
  });
});

describe("eventIngestorRegionFor", () => {
  it("follows a single forwarder region", () => {
    expect(eventIngestorRegionFor(["eu-west-1"], "us-east-1")).toBe(
      "eu-west-1",
    );
  });

  it("leaves the host to the SDK default when both regions receive it", () => {
    expect(
      eventIngestorRegionFor(["us-east-1", "eu-west-1"], "us-east-1"),
    ).toBeUndefined();
  });

  it("falls back to the organization's region", () => {
    expect(eventIngestorRegionFor([], "eu-west-1")).toBe("eu-west-1");
    expect(eventIngestorRegionFor([], undefined)).toBeUndefined();
  });
});
