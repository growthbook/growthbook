import { z } from "zod";
import { ListSegmentsResponse } from "../../../types/api";
import {
  findSegmentsByOrganization,
  toSegmentApiInterface,
} from "../../models/SegmentModel";
import { applyPagination, createApiRequestHandler } from "../../util/handler";

export const listSegments = createApiRequestHandler({
  querySchema: z
    .object({
      limit: z.string().optional(),
      offset: z.string().optional(),
    })
    .strict(),
})(
  async (req): Promise<ListSegmentsResponse> => {
    const segments = await findSegmentsByOrganization(req.organization.id);

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      segments.sort((a, b) => a.id.localeCompare(b.id)),
      req.query
    );

    return {
      segments: filtered.map((segment) => toSegmentApiInterface(segment)),
      ...returnFields,
    };
  }
);
