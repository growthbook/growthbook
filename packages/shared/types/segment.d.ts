import { z } from "zod";
import { segmentValidator } from "shared/validators";

export type SegmentInterface = z.infer<typeof segmentValidator>;
