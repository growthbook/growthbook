import { z } from "zod";
import {
  configValidator,
  postConfigBodyValidator,
  putConfigBodyValidator,
} from "shared/validators";

export type ConfigInterface = z.infer<typeof configValidator>;

// Value-omitted projection loaded into the definitions context (values can be
// large). Full values are fetched on demand.
export type ConfigWithoutValue = Omit<ConfigInterface, "value">;

export type PostConfigBody = z.infer<typeof postConfigBodyValidator>;

export type PutConfigBody = z.infer<typeof putConfigBodyValidator>;
