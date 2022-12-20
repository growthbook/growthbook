import { ServerResponse, IncomingMessage } from "http";
import crypto from "crypto";
import { WebClient } from "@slack/web-api";
import { SLACK_SIGNING_SECRET } from "../util/secrets";
import { UserModel } from "../models/UserModel";
import { OrganizationInterface } from "../../types/organization";

// Initialize a single instance for the whole app
const web = new WebClient();

export function verifySlackRequestSignature(
  req: IncomingMessage,
  res: ServerResponse,
  buf: Buffer
) {
  const rawTimestamp = req.headers["x-slack-request-timestamp"];
  if (!rawTimestamp || typeof rawTimestamp !== "string") {
    throw new Error("Missing or Invalid timestamp");
  }

  // Verify request happened recently to protect against replay attacks
  const timestamp = parseInt(rawTimestamp);
  if (Math.abs(timestamp - Date.now() / 1000) > 60 * 5) {
    throw new Error("Invalid timestamp");
  }

  // Hash the request and compare with the signature header to verify
  const str = "v0:" + timestamp + ":" + buf.toString();
  const sig =
    "v0=" +
    crypto.createHmac("sha256", SLACK_SIGNING_SECRET).update(str).digest("hex");
  const slackSignature = req.headers["x-slack-signature"] as string;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(slackSignature))) {
    throw new Error("Signatures do not match");
  }
}

export async function getUserInfoBySlackId(
  slackUserId: string,
  organization: OrganizationInterface
): Promise<{ id: null | string; name: null | string }> {
  try {
    const res = await web.users.info({
      token: organization?.connections?.slack?.token,
      user: slackUserId,
    });

    const slackUser = res.user as {
      real_name?: string;
      profile?: { email?: string };
    };
    const email = slackUser?.profile?.email;

    let id: string | null = null;
    if (email) {
      const user = await UserModel.findOne({ email });
      if (user) {
        // Make sure user is part of the organization
        if (organization.members.map((m) => m.id).includes(user.id)) {
          id = user.id;
        }
      }
    }

    // Can't find matching user in our database, just use the full name instead
    return {
      id,
      name: slackUser.real_name || null,
    };
  } catch (e) {
    return {
      id: null,
      name: null,
    };
  }
}
export function formatTextResponse(markdown: string) {
  return {
    text: markdown,
    mrkdwn: true,
  };
}
