import { z } from "zod";
import { segmentValidator } from "@back-end/src/routers/segment/segment.validators";

export type SegmentInterface = z.infer<typeof segmentValidator>;
