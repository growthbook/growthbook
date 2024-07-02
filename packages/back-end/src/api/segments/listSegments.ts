import { toSegmentApiInterface } from "../../services/segments";
import { ListSegmentsResponse } from "../../../types/openapi";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "../../util/handler";
import { listSegmentsValidator } from "../../validators/openapi";

export const listSegments = createApiRequestHandler(listSegmentsValidator)(
  async (req): Promise<ListSegmentsResponse> => {
    const segments = await req.context.models.segments.getAll();

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      segments
        .filter((segment) =>
          applyFilter(req.query.datasourceId, segment.datasource)
        )
        .sort((a, b) => a.id.localeCompare(b.id)),
      req.query
    );

    return {
      segments: filtered.map((segment) => toSegmentApiInterface(segment)),
      ...returnFields,
    };
  }
);
