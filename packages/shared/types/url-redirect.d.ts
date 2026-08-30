import { z } from "zod";
import {
  urlRedirectValidator,
  destinationUrlValidator,
} from "shared/validators";
import { CreateProps, UpdateProps } from "shared/types/base-model";

export type DestinationURL = z.infer<typeof destinationUrlValidator>;

export type URLRedirectInterface = z.infer<typeof urlRedirectValidator>;

export type CreateURLRedirectProps = CreateProps<URLRedirectInterface>;
export type UpdateURLRedirectProps = UpdateProps<URLRedirectInterface>;
