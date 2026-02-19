import { z } from "zod";
import { teamSchema } from "shared/validators";

export type TeamInterface = z.infer<typeof teamSchema>;
