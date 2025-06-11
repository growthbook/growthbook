import { z } from "zod/v4";
import { segmentValidator } from "back-end/src/routers/segment/segment.validators";

export type SegmentInterface = z.infer<typeof segmentValidator>;
