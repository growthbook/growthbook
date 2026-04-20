import { listSegmentsValidator } from "shared/validators";
import { toSegmentApiInterface } from "back-end/src/services/segments";
import { buildOwnerEmailMap } from "back-end/src/services/owner";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listSegments = createApiRequestHandler(listSegmentsValidator)(
  async (req) => {
    const segments = await req.context.models.segments.getAll();

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      segments
        .filter((segment) =>
          applyFilter(req.query.datasourceId, segment.datasource),
        )
        .sort((a, b) => a.id.localeCompare(b.id)),
      req.query,
    );

    const ownerEmailMap = await buildOwnerEmailMap(
      filtered.map((s) => s.owner),
      req.context,
    );
    return {
      segments: filtered.map((segment) =>
        toSegmentApiInterface(segment, ownerEmailMap),
      ),
      ...returnFields,
    };
  },
);
