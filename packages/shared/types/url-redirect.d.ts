import { z } from "zod";
import {
  urlRedirectValidator,
  destinationUrlValidator,
} from "shared/validators";
import { CreateProps } from "shared/types/base-model";

export type DestinationURL = z.infer<typeof destinationUrlValidator>;

export type URLRedirectInterface = z.infer<typeof urlRedirectValidator>;

export type CreateURLRedirectProps = CreateProps<URLRedirectInterface>;
