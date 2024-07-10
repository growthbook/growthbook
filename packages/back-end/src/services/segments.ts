import { ApiSegment } from "@back-end/types/openapi";
import { SegmentInterface } from "@back-end/types/segment";

export function toSegmentApiInterface(segment: SegmentInterface): ApiSegment {
  return {
    id: segment.id,
    name: segment.name,
    owner: segment.owner || "",
    identifierType: segment.userIdType || "user_id",
    query: segment.sql || "",
    datasourceId: segment.datasource || "",
    type: segment.sql ? "SQL" : "FACT",
    factTableId: segment.factTableId || "",
    filters: segment.filters || [],
    dateCreated: segment.dateCreated?.toISOString() || "",
    dateUpdated: segment.dateUpdated?.toISOString() || "",
  };
}
