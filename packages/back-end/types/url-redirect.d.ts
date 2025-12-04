import { z } from "zod";
import { CreateProps, UpdateProps } from "shared/types/baseModel";
import {
  urlRedirectValidator,
  destinationUrlValidator,
} from "back-end/src/routers/url-redirects/url-redirects.validators";

export type DestinationURL = z.infer<typeof destinationUrlValidator>;

export type URLRedirectInterface = z.infer<typeof urlRedirectValidator>;

export type CreateURLRedirectProps = CreateProps<URLRedirectInterface>;
export type UpdateURLRedirectProps = UpdateProps<URLRedirectInterface>;
