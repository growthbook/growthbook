import { resolveApiResource } from "back-end/src/api/resources";

const route = (
  method: "get" | "post" | "put" | "delete",
  path: string,
  operationId: string,
  version?: "v1" | "v2",
) => ({ method, path, operationId, version });

describe("resolveApiResource", () => {
  it("maps collection and item routes to CRUD operations", () => {
    expect(
      resolveApiResource({ name: "project", path: "/projects" }, [
        route("get", "/projects", "listProjects"),
        route("post", "/projects", "postProject"),
        route("get", "/projects/:id", "getProject"),
        route("put", "/projects/:id", "putProject"),
        route("delete", "/projects/:id", "deleteProject"),
      ]),
    ).toEqual({
      list: "listProjects",
      create: "postProject",
      get: "getProject",
      update: "putProject",
      delete: "deleteProject",
    });
  });

  it("ignores action routes, other versions, and unrelated prefixes", () => {
    expect(
      resolveApiResource(
        { name: "feature", path: "/features", version: "v2" },
        [
          route("post", "/features/:id", "updateFeature"),
          route("post", "/features/:id/toggle", "toggleFeatureV2", "v2"),
          route("get", "/features-archive/:id", "getArchive", "v2"),
          route("post", "/features/:id", "updateFeatureV2", "v2"),
        ],
      ),
    ).toEqual({ update: "updateFeatureV2" });
  });

  it("accepts any item param name and skips routes left out of the spec", () => {
    expect(
      resolveApiResource({ name: "attribute", path: "/attributes" }, [
        { ...route("get", "/attributes", "hidden"), excludeFromSpec: true },
        route("get", "/attributes", "listAttributes"),
        route("put", "/attributes/:property", "putAttribute"),
      ]),
    ).toEqual({ list: "listAttributes", update: "putAttribute" });
  });
});
