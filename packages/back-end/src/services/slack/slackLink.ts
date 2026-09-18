import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { APP_ORIGIN, JWT_SECRET } from "back-end/src/util/secrets";

const LINK_STATE_MAX_AGE_MS = 15 * 60 * 1000;
const linkStateSchema = z.strictObject({
  slackTeamId: z.string().min(1),
  slackUserId: z.string().min(1),
  nonce: z.string().min(1),
  createdAt: z.number().finite(),
});
export type SlackLinkState = z.infer<typeof linkStateSchema>;

const sign = (payload: string) =>
  createHmac("sha256", JWT_SECRET).update(payload).digest("base64url");

export function buildSlackLinkUrl(
  identity: Pick<SlackLinkState, "slackTeamId" | "slackUserId"> & {
    nonce?: string;
  },
): string {
  const payload = Buffer.from(
    JSON.stringify({
      ...identity,
      nonce: identity.nonce ?? randomBytes(12).toString("base64url"),
      createdAt: Date.now(),
    }),
  ).toString("base64url");
  return `${APP_ORIGIN.replace(/\/$/, "")}/integrations/slack/link?state=${encodeURIComponent(`${payload}.${sign(payload)}`)}`;
}

export function verifySlackLinkState(state: string): SlackLinkState | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null;

  try {
    const input: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    const parsed = linkStateSchema.safeParse(input);
    if (!parsed.success) return null;
    const age = Date.now() - parsed.data.createdAt;
    return age >= 0 && age <= LINK_STATE_MAX_AGE_MS ? parsed.data : null;
  } catch {
    return null;
  }
}
