import type { CrudAction } from "shared/api-model";
import type { HttpVerb } from "shared/api-spec";
import { OpenApiRoute } from "back-end/src/util/handler";

/** A REST resource that tooling (Terraform, the CLI) manages as one object. */
export type ApiResourceEntry = {
  name: string;
  path: string;
  version?: "v1" | "v2";
};

export type ApiResourceOperations = Partial<Record<CrudAction, string>>;

// BaseModel specs are added in api.router; these are hand-written routes.
export const legacyApiResources: ApiResourceEntry[] = [
  { name: "project", path: "/projects" },
  { name: "attribute", path: "/attributes" },
  { name: "sdk_connection", path: "/sdk-connections" },
  { name: "feature", path: "/features", version: "v2" },
];

// Collection routes sit at `path`, item routes at `path/:param`.
export function resolveApiResource(
  { path, version = "v1" }: ApiResourceEntry,
  routes: Pick<
    OpenApiRoute,
    "method" | "path" | "operationId" | "version" | "excludeFromSpec"
  >[],
): ApiResourceOperations {
  const itemPath = new RegExp(`^${path}/:\\w+$`);
  // Methods in order of preference, so registration order doesn't decide.
  const find = (methods: HttpVerb[], item: boolean) =>
    methods
      .map(
        (method) =>
          routes.find(
            (route) =>
              !route.excludeFromSpec &&
              (route.version ?? "v1") === version &&
              route.method === method &&
              (item ? itemPath.test(route.path) : route.path === path),
          )?.operationId,
      )
      .find(Boolean);

  const operations: ApiResourceOperations = {
    create: find(["post"], false),
    list: find(["get"], false),
    get: find(["get"], true),
    update: find(["put", "patch", "post"], true),
    delete: find(["delete"], true),
  };
  return Object.fromEntries(
    Object.entries(operations).filter(([, operationId]) => operationId),
  );
}
