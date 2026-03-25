import { postSegmentValidator } from "shared/validators";
import { PostSegmentResponse } from "shared/types/openapi";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getFactTable } from "back-end/src/models/FactTableModel";
import { toSegmentApiInterface } from "back-end/src/services/segments";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const postSegment = createApiRequestHandler(postSegmentValidator)(async (
  req,
): Promise<PostSegmentResponse> => {
  const datasourceDoc = await getDataSourceById(
    req.context,
    req.body.datasourceId,
  );
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }

  // Validate inputs for FACT segments
  if (req.body.type === "FACT") {
    if (!req.body.factTableId) {
      throw new Error("Fact table ID is required for FACT segments");
    }

    const factTableDoc = await getFactTable(req.context, req.body.factTableId);

    if (!factTableDoc) {
      throw new Error("Invalid fact table");
    }

    if (factTableDoc.datasource !== datasourceDoc.id) {
      throw new Error("Fact table does not belong to the same data source");
    }

    if (req.body.query) {
      throw new Error("SQL query is not allowed for FACT segments");
    }
  }

  // Validate inputs for SQL segments
  if (req.body.type === "SQL") {
    if (!req.body.query) {
      throw new Error("SQL query is required for SQL segments");
    }

    if (req.body.factTableId) {
      throw new Error("Fact table ID is not allowed for SQL segments");
    }

    if (req.body.filters) {
      throw new Error("Filters are not allowed for SQL segments");
    }
  }

  const segmentData = {
    name: req.body.name,
    owner: req.context.userId || "",
    description: req.body.description || "",
    userIdType: req.body.identifierType,
    sql: req.body.query,
    datasource: req.body.datasourceId,
    type: req.body.type,
    factTableId: req.body.factTableId,
    filters: req.body.filters,
    projects: req.body.projects,
    managedBy: req.body.managedBy,
  };

  const segment = await req.context.models.segments.create(segmentData);

  return {
    segment: toSegmentApiInterface(segment),
  };
});
