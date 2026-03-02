import { SegmentInterface } from "shared/types/segment";
import { ApiSegment } from "shared/types/openapi";

export function toSegmentApiInterface(segment: SegmentInterface): ApiSegment {
  return {
    id: segment.id,
    name: segment.name,
    owner: segment.owner || "",
    identifierType: segment.userIdType || "user_id",
    query: segment.sql || "",
    datasourceId: segment.datasource || "",
    type: segment.type,
    factTableId: segment.factTableId || "",
    filters: segment.filters || [],
    dateCreated: segment.dateCreated?.toISOString() || "",
    dateUpdated: segment.dateUpdated?.toISOString() || "",
    managedBy: segment.managedBy || "",
    projects: segment.projects || [],
  };
}
