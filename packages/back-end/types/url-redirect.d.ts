import { z } from "zod";
import {
  createUrlRedirectValidator,
  updateUrlRedirectValidator,
} from "@back-end/src/routers/url-redirects/url-redirects.validators";

export interface DestinationURL {
  url: string;
  variation: string;
}

export interface URLRedirectInterface {
  id: string;
  dateCreated: Date;
  dateUpdated: Date;
  organization: string;
  experiment: string;
  urlPattern: string;
  destinationURLs: DestinationURL[];
  persistQueryString: boolean;
}

export type CreateURLRedirectProps = z.infer<typeof createUrlRedirectValidator>;
export type UpdateURLRedirectProps = z.infer<typeof updateUrlRedirectValidator>;
