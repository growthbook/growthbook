import type {
  DataSourceInterface,
  ExposureQuery,
} from "shared/types/datasource";

export function getExposureQuery(
  datasource: DataSourceInterface,
  exposureQueryId: string,
  userIdType?: "anonymous" | "user",
): ExposureQuery {
  let id = exposureQueryId;
  if (!id) {
    id = userIdType === "user" ? "user_id" : "anonymous_id";
  }

  const queries = datasource.settings?.queries?.exposure || [];

  const match = queries.find((q) => q.id === id);

  if (!match) {
    throw new Error("Unknown experiment assignment table - " + id);
  }

  return match;
}
