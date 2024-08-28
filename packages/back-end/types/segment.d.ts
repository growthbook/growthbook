import { z } from "zod";
import { segmentValidator } from "../src/routers/segment/segment.validators";

export type SegmentInterface = z.infer<typeof segmentValidator>;
