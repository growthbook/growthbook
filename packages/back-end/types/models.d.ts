import { z } from "zod";
import { BaseSchema } from "../src/models/BaseModel";

export type CreateProps<T extends z.infer<BaseSchema>> = Omit<
  T,
  "id" | "organization" | "dateCreated" | "dateUpdated"
> & { id?: string };

export type UpdateProps<T extends z.infer<BaseSchema>> = Partial<
  Omit<T, "id" | "organization" | "dateCreated" | "dateUpdated">
>;
