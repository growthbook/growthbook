import { randomBytes } from "node:crypto";
import { z } from "zod";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { signState, verifySignedState } from "back-end/src/util/signedState";

const LINK_STATE_MAX_AGE_MS = 15 * 60 * 1000;
const linkStateSchema = z.strictObject({
  slackTeamId: z.string().min(1),
  slackUserId: z.string().min(1),
  nonce: z.string().min(1),
  createdAt: z.number().finite(),
});
export type SlackLinkState = z.infer<typeof linkStateSchema>;

export function buildSlackLinkUrl(
  identity: Pick<SlackLinkState, "slackTeamId" | "slackUserId">,
): string {
  const state = signState({
    ...identity,
    nonce: randomBytes(12).toString("base64url"),
    createdAt: Date.now(),
  });
  return `${APP_ORIGIN.replace(/\/$/, "")}/integrations/slack/link?state=${encodeURIComponent(state)}`;
}

export function verifySlackLinkState(state: string): SlackLinkState | null {
  const verified = verifySignedState(
    state,
    linkStateSchema,
    LINK_STATE_MAX_AGE_MS,
  );
  return verified.status === "valid" ? verified.data : null;
}
