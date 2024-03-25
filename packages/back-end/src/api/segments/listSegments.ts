import { listSegmentsValidator } from "@back-end/src/validators/openapi";
import { ListSegmentsResponse } from "@back-end/types/openapi";
import {
  findSegmentsByOrganization,
  toSegmentApiInterface,
} from "@back-end/src/models/SegmentModel";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "@back-end/src/util/handler";

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
