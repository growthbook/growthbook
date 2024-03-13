import { listSegmentsValidator } from "@/src/validators/openapi";
import { ListSegmentsResponse } from "@/types/openapi";
import {
  findSegmentsByOrganization,
  toSegmentApiInterface,
} from "@/src/models/SegmentModel";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "@/src/util/handler";

export const listSegments = createApiRequestHandler(listSegmentsValidator)(
  async (req): Promise<ListSegmentsResponse> => {
    const segments = await findSegmentsByOrganization(req.organization.id);

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
