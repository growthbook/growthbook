import { z } from "zod";
import { segmentValidator } from "@back-end/src/routers/segment/segment.validators";

export type SegmentInterface = z.infer<typeof segmentValidator>;

// export type SqlSegmentInterface = z.infer<typeof sqlSegmentSchema>;
// export type FactSegmentInterface = z.infer<typeof factSegmentSchema>;

// export type SegmentInterface = SqlSegmentInterface | FactSegmentInterface;
