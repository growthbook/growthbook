import { z } from "zod";
import { slackUserLinkSchema, SlackUserLinkInterface } from "shared/validators";

const storedLinkSchema = slackUserLinkSchema
  .partial({ organization: true })
  .extend({ organizationId: z.string().optional() })
  .strip();

// Preserve links created by the earlier Mongoose implementation, including
// its audit-only organizationId field. Ignore Mongo's _id and __v metadata.
export function parseSlackUserLink(doc: unknown): SlackUserLinkInterface {
  const { organizationId, organization, ...link } = storedLinkSchema.parse(doc);
  return slackUserLinkSchema.parse({
    ...link,
    organization: organization ?? organizationId,
  });
}
