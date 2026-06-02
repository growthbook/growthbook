import { z } from "zod";
import { ideaSourceValidator, ideaValidator } from "shared/validators";

// Where the idea was submitted from
export type IdeaSource = z.infer<typeof ideaSourceValidator>;

export type IdeaInterface = z.infer<typeof ideaValidator>;
