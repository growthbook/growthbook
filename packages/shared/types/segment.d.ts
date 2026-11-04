import type { z } from "zod";
import type { segmentValidator } from "shared/validators";

export type SegmentInterface = z.infer<typeof segmentValidator>;
