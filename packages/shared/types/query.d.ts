import { z } from "zod";
import { sqlResultChunkValidator } from "shared/validators";

export type SqlResultChunkInterface = z.infer<typeof sqlResultChunkValidator>;
