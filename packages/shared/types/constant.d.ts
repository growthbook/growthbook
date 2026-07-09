import { z } from "zod";
import {
  constantValidator,
  constantTypeValidator,
  postConstantBodyValidator,
  putConstantBodyValidator,
} from "shared/validators";

export type ConstantType = z.infer<typeof constantTypeValidator>;

export type ConstantInterface = z.infer<typeof constantValidator>;

// Value-omitted projection loaded into the definitions context (values can be
// large). Full values are fetched on demand.
export type ConstantWithoutValue = Omit<
  ConstantInterface,
  "value" | "environmentValues"
>;

export type PostConstantBody = z.infer<typeof postConstantBodyValidator>;

export type PutConstantBody = z.infer<typeof putConstantBodyValidator>;
