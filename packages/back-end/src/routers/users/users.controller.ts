import { createHmac } from "node:crypto";
import { Response } from "express";
import { z } from "zod";
import { OrganizationInterface } from "shared/types/organization";
import { KnownBlock } from "@slack/types";
import { IS_CLOUD, NPS_SLACK_WEBHOOK } from "back-end/src/util/secrets";
import { sendSlackMessage } from "back-end/src/events/handlers/slack/slack-event-handler-utils";
import {
  escapeSlackMrkdwn,
  truncateSlackText,
} from "back-end/src/util/slack.util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { usingOpenId } from "back-end/src/services/auth";
import { findOrganizationsByMemberId } from "back-end/src/models/OrganizationModel";
import {
  addMemberFromSSOConnection,
  findVerifiedOrgsForNewUser,
  getContextFromReq,
  validateLoginMethod,
} from "back-end/src/services/organizations";
import {
  createUser,
  getUserByEmail,
  updateUser,
} from "back-end/src/models/UserModel";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { findRecentAuditByUserIdAndOrganization } from "back-end/src/models/AuditModel";

function isValidWatchEntityType(type: string): boolean {
  if (type === "experiment" || type === "feature") {
    return true;
  } else {
    return false;
  }
}
export async function getHistoryByUser(req: AuthRequest<null>, res: Response) {
  const { org, userId } = getContextFromReq(req);
  const events = await findRecentAuditByUserIdAndOrganization(userId, org.id);
  res.status(200).json({
    status: 200,
    events,
  });
}

// Pylon doesn't do any identity verification, so this hashes a user's email with a secret
// to prevent bad actors trying to impersonate our users or get access to their data.
function createPylonHmacHash(email: string) {
  const secretBytes = Buffer.from(
    process.env.PYLON_VERIFICATION_SECRET || "",
    "hex",
  );
  return createHmac("sha256", secretBytes).update(email).digest("hex");
}

export async function getUser(req: AuthRequest, res: Response) {
  // If using SSO, auto-create users in Mongo who we don't recognize yet
  if (!req.userId && usingOpenId()) {
    let agreedToTerms = false;
    if (IS_CLOUD) {
      // we know if they agreed to terms if they are using Cloud SSO
      agreedToTerms = true;
    }
    const user = await createUser({
      name: req.name || "",
      email: req.email,
      password: "",
      verified: req.verified,
      agreedToTerms,
    });
    req.userId = user.id;
    req.currentUser = user;
  }

  if (!req.userId) {
    throw new Error("Must be logged in");
  }

  const userId = req.userId;

  // List of all organizations the user belongs to
  const orgs = await findOrganizationsByMemberId(userId);

  // If the user is not in an organization yet and is using SSO
  // Check to see if they should be auto-added to one based on their email domain
  if (!orgs.length) {
    const autoOrg = await addMemberFromSSOConnection(req);
    if (autoOrg) {
      orgs.push(autoOrg);
    }
  }

  // Filter out orgs that the user can't log in to
  let lastError = "";
  const validOrgs = orgs.filter((org) => {
    try {
      validateLoginMethod(org, req);
      return true;
    } catch (e) {
      lastError = e;
      return false;
    }
  });

  // If all of a user's orgs were filtered out, throw an error
  if (orgs.length && !validOrgs.length) {
    throw new Error(lastError || "Must login with SSO");
  }

  return res.status(200).json({
    status: 200,
    userId: userId,
    userName: req.name,
    email: req.email,
    pylonHmacHash: createPylonHmacHash(req.email),
    superAdmin: !!req.superAdmin,
    npsSurveyStatus: req.currentUser?.npsSurveyStatus,
    npsSurveyAt: req.currentUser?.npsSurveyAt?.toISOString(),
    organizations: validOrgs.map((org) => {
      return {
        id: org.id,
        name: org.name,
      };
    }),
  });
}

export async function putUserName(
  req: AuthRequest<{ name: string }>,
  res: Response,
) {
  const { name } = req.body;
  const { userId } = getContextFromReq(req);

  try {
    await updateUser(userId, { name });
    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
}

const MAX_FEEDBACK_LENGTH = 1500;
// Slack rejects a section block whose text exceeds 3000 characters.
const SLACK_SECTION_TEXT_LIMIT = 3000;
// Server-side re-survey throttle, mirroring the client's 90-day cooldown.
const NPS_RESURVEY_MS = 90 * 24 * 60 * 60 * 1000;

// How the user exited the survey; "submitted" is the only path where the
// feedback text was explicitly sent. Values outside this list are dropped.
const NPS_DISPOSITIONS = [
  "submitted",
  "skipped",
  "dismissed",
  "abandoned",
] as const;
type NpsDisposition = (typeof NPS_DISPOSITIONS)[number];

// The request body is untrusted, so validate it before use rather than trusting
// the AuthRequest type. Zod is the source of truth for the shape; the handler
// infers its body type from this schema.
const npsResponseBody = z
  .object({
    status: z.enum(["responded", "dismissed"]),
    score: z.number().int().min(0).max(10).optional(),
    feedback: z.string().max(10000).optional(),
    disposition: z.enum(NPS_DISPOSITIONS).optional(),
  })
  .refine((b) => b.status !== "responded" || b.score !== undefined, {
    message: "score is required when status is responded",
    path: ["score"],
  });

async function sendNpsResponseToSlack({
  score,
  feedback,
  email,
  disposition,
}: {
  score: number;
  feedback: string;
  email: string;
  disposition?: NpsDisposition;
}): Promise<void> {
  const category =
    score >= 9 ? "Promoter" : score <= 6 ? "Detractor" : "Passive";
  // Left color bar on the attachment carries the sentiment, so sentiment reads
  // at a glance and stacked responses stay visually separated.
  const color = score >= 9 ? "#2eb67d" : score <= 6 ? "#e01e5a" : "#ecb22e";

  const safeFeedback = escapeSlackMrkdwn(
    feedback.slice(0, MAX_FEEDBACK_LENGTH),
  );
  const header = `*NPS ${score}/10 · ${category}*`;
  const fullText = safeFeedback
    ? `${header}\n> ${safeFeedback.replace(/\n/g, "\n> ")}`
    : header;
  // Clamp so escape expansion can't push the block past Slack's limit and get
  // the whole message rejected.
  const sectionText = truncateSlackText(fullText, SLACK_SECTION_TEXT_LIMIT);

  // A "submitted" score is the norm, so only the other exits are called out —
  // a score with no comment reads differently when the survey was abandoned.
  const exitNote =
    disposition && disposition !== "submitted" ? `   ·   ${disposition}` : "";

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: sectionText,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `:bust_in_silhouette:  ${email}${exitNote}`,
        },
      ],
    },
  ];

  // Delegate transport to the shared Slack sender (timeout, ok-check, and
  // error logging live there); this builder only owns the message shape.
  await sendSlackMessage(
    {
      attachments: [
        {
          color,
          // Notification-only fallback; not shown in-channel.
          fallback: `NPS ${score}/10 (${category}) from ${email}${exitNote}`,
          blocks,
        },
      ],
    },
    NPS_SLACK_WEBHOOK,
  );
}

export async function postNpsResponse(
  req: AuthRequest<z.infer<typeof npsResponseBody>>,
  res: Response,
) {
  const parsed = npsResponseBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 400,
      message: "Invalid NPS response",
    });
  }
  const { status, score, feedback, disposition } = parsed.data;

  const { userId } = getContextFromReq(req);

  // Throttle Slack forwarding against the user's *existing* survey date (set by
  // the auth middleware, before the write below overwrites it), mirroring the
  // client's 90-day cooldown so a scripted client can't flood the channel.
  const priorAt = req.currentUser?.npsSurveyAt;
  const recentlyRecorded =
    !!priorAt && Date.now() - new Date(priorAt).getTime() < NPS_RESURVEY_MS;

  await updateUser(userId, {
    npsSurveyStatus: status,
    npsSurveyAt: new Date(),
  });

  // Internal-only: forward actual responses to GrowthBook's own Slack.
  // Gated on IS_CLOUD plus a private webhook env var that only GrowthBook
  // Cloud sets, so self-hosted and Cloud users never trigger or see this.
  // Feedback text is only forwarded on an explicit "submitted" exit, matching
  // the client contract. Fire-and-forget — a Slack failure must never affect
  // the user's request.
  if (
    IS_CLOUD &&
    status === "responded" &&
    score !== undefined &&
    NPS_SLACK_WEBHOOK &&
    !recentlyRecorded
  ) {
    void sendNpsResponseToSlack({
      score,
      feedback: disposition === "submitted" ? (feedback ?? "").trim() : "",
      email: req.email,
      disposition,
    });
  }

  res.status(200).json({
    status: 200,
  });
}

export async function postWatchItem(
  req: AuthRequest<null, { type: string; id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const { type, id } = req.params;
  let item;

  if (!isValidWatchEntityType(type)) {
    return res.status(400).json({
      status: 400,
      message:
        "Invalid entity type. Type must be either experiment or feature.",
    });
  }

  if (type === "feature") {
    item = await getFeature(context, id);
  } else if (type === "experiment") {
    item = await getExperimentById(context, id);
    if (item && item.organization !== org.id) {
      res.status(403).json({
        status: 403,
        message: "You do not have access to this experiment",
      });
      return;
    }
  }
  if (!item) {
    throw new Error(`Could not find ${item}`);
  }

  await context.models.watch.upsertWatch({
    userId,
    item: id,
    type: type === "experiment" ? "experiments" : "features", // Pluralizes entity type for the Watch model,
  });

  return res.status(200).json({
    status: 200,
  });
}

export async function postUnwatchItem(
  req: AuthRequest<null, { type: string; id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { userId } = context;
  const { type, id } = req.params;

  if (!isValidWatchEntityType(type)) {
    return res.status(400).json({
      status: 400,
      message:
        "Invalid entity type. Type must be either experiment or feature.",
    });
  }

  try {
    await context.models.watch.deleteWatchedByEntity({
      userId,
      type: type === "experiment" ? "experiments" : "features", // Pluralizes entity type for the Watch model
      item: id,
    });

    return res.status(200).json({
      status: 200,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function getRecommendedOrgs(req: AuthRequest, res: Response) {
  const { email } = req;
  const user = await getUserByEmail(email);
  if (!user?.verified) {
    return res.status(200).json({
      message: "no verified user found",
    });
  }
  const orgs = await findVerifiedOrgsForNewUser(email);

  // Filter out orgs that the user is already a member of
  const joinableOrgs = orgs?.filter((org) => {
    return !org.members.find((m) => m.id === user.id);
  });

  if (joinableOrgs) {
    return res.status(200).json({
      organizations: joinableOrgs.map((org: OrganizationInterface) => {
        const currentUserIsPending = !!org?.pendingMembers?.find(
          (m) => m.id === user.id,
        );
        return {
          id: org.id,
          name: org.name,
          members: org?.members?.length || 0,
          currentUserIsPending,
        };
      }),
    });
  }
  res.status(200).json({
    message: "no org found",
  });
}
