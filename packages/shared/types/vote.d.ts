import { z } from "zod";
import { voteValidator } from "shared/validators";

export type Vote = z.infer<typeof voteValidator>;

export type VoteDirType = Vote["dir"];
