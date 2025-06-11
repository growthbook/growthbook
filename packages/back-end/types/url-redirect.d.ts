import { z } from "zod/v4";
import {
  urlRedirectValidator,
  destinationUrlValidator,
} from "back-end/src/routers/url-redirects/url-redirects.validators";
import { CreateProps, UpdateProps } from "./models";

export type DestinationURL = z.infer<typeof destinationUrlValidator>;

export type URLRedirectInterface = z.infer<typeof urlRedirectValidator>;

export type CreateURLRedirectProps = CreateProps<URLRedirectInterface>;
export type UpdateURLRedirectProps = UpdateProps<URLRedirectInterface>;
