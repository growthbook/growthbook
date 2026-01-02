import { SegmentInterface } from "shared/types/segment";
import { UpdateSegmentResponse } from "shared/types/openapi";
import { updateSegmentValidator } from "shared/validators";
import { toSegmentApiInterface } from "back-end/src/services/segments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getFactTable } from "back-end/src/models/FactTableModel";

export const updateSegment = createApiRequestHandler(updateSegmentValidator)(
  async (req): Promise<UpdateSegmentResponse> => {
    const existing = await req.context.models.segments.getById(req.params.id);

    if (!existing) {
      throw new Error("Could not find segment with that id");
    }

    const datasourceDoc = await getDataSourceById(
      req.context,
      req.body.datasourceId || existing.datasource,
    );

    if (!datasourceDoc) {
      throw new Error("Invalid data source");
    }

    // We don't allow changing the type in the app, so extending that here
    // There are too many ways for this to break trying to manage that.
    if (req.body.type && req.body.type !== existing.type) {
      throw new Error(
        "Cannot change the type of a segment. Delete and create a new segment instead.",
      );
    }

    // Validate inputs for FACT segments
    if (req.body.type === "FACT") {
      if (!req.body.factTableId) {
        throw new Error("Fact table ID is required for FACT segments");
      }

      const factTableDoc = await getFactTable(
        req.context,
        req.body.factTableId,
      );

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

    const updates: Partial<SegmentInterface> = {};
    if (req.body.name) updates.name = req.body.name;
    if (req.body.description !== undefined) {
      updates.description = req.body.description;
    }
    if (req.body.datasourceId) updates.datasource = req.body.datasourceId;
    if (req.body.identifierType) updates.userIdType = req.body.identifierType;
    if (req.body.projects) updates.projects = req.body.projects;
    if (req.body.managedBy !== undefined) {
      updates.managedBy = req.body.managedBy;
    }
    if (req.body.query) updates.sql = req.body.query;
    if (req.body.factTableId) updates.factTableId = req.body.factTableId;
    if (req.body.filters) updates.filters = req.body.filters;

    const segment = await req.context.models.segments.update(existing, updates);

    return {
      segment: toSegmentApiInterface(segment),
    };
  },
);
