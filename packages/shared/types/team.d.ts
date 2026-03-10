import { z } from "zod";
import { apiTeamValidator, teamSchema } from "shared/validators";

export type TeamInterface = z.infer<typeof teamSchema>;

export type ApiTeamInterface = z.infer<typeof apiTeamValidator>;
