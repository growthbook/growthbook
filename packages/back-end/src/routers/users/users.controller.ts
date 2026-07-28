import { createHmac } from "node:crypto";
import { Response } from "express";
import { OrganizationInterface } from "shared/types/organization";
import { NPS_CATEGORY_META, npsCategoryOf } from "shared/nps";
import {
  NpsDisposition,
  NpsResponseBody,
  npsResponseBodyValidator,
} from "shared/validators";
import { KnownBlock } from "@slack/types";
import { IS_CLOUD, NPS_SLACK_WEBHOOK } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
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
    // Only the date is sent: the client uses it for the re-survey window, and
    // nothing reads the status, so it stays server-side.
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

async function sendNpsResponseToSlack({
  score,
  feedback,
  email,
  disposition,
  supersedes,
  preview,
}: {
  score: number;
  feedback: string;
  email: string;
  disposition?: NpsDisposition;
  supersedes?: NpsDisposition;
  preview?: boolean;
}): Promise<void> {
  // Bands and the sentiment colour come from shared so the Slack message can't
  // disagree with the category the front-end reports in telemetry.
  const { label: category, slackColor: color } =
    NPS_CATEGORY_META[npsCategoryOf(score)];

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
  // An update names the state it replaces, so the earlier message it follows
  // (e.g. the same score already posted as abandoned) is easy to tie together.
  // Staff previews are labelled so they're never mistaken for real feedback.
  const notes = [
    disposition && disposition !== "submitted" ? disposition : "",
    supersedes ? `updated from ${supersedes}` : "",
    preview ? "preview" : "",
  ].filter(Boolean);
  const exitNote = notes.length ? `   ·   ${notes.join("   ·   ")}` : "";

  // The email is user-controlled in SSO/SCIM deployments, so escape it too —
  // otherwise it's the one field that could smuggle a `<!channel>` ping past
  // the escaping applied to the feedback beside it.
  const safeEmail = escapeSlackMrkdwn(email);

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
          text: `:bust_in_silhouette:  ${safeEmail}${exitNote}`,
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
          fallback: `NPS ${score}/10 (${category}) from ${safeEmail}${exitNote}`,
          blocks,
        },
      ],
    },
    NPS_SLACK_WEBHOOK,
  );
}

export async function postNpsResponse(
  req: AuthRequest<NpsResponseBody>,
  res: Response,
) {
  const parsed = npsResponseBodyValidator.safeParse(req.body);
  if (!parsed.success) {
    // Log it: a client/server contract drift would otherwise be invisible and
    // look exactly like "nobody is responding to the survey".
    logger.warn(
      { issues: parsed.error.issues },
      "Rejected malformed NPS response",
    );
    return res.status(400).json({
      status: 400,
      message: "Invalid NPS response",
    });
  }
  const { status, score, feedback, disposition, supersedes, preview } =
    parsed.data;

  const { userId } = getContextFromReq(req);

  // A staff preview (`?show-nps`) still forwards to Slack so the path stays
  // testable, but must not consume the previewer's own re-survey window.
  if (!preview) {
    await updateUser(userId, {
      npsSurveyStatus: status,
      npsSurveyAt: new Date(),
    });
  }

  // Forward actual responses to Slack. Gated solely on the private webhook env
  // var — only GrowthBook Cloud sets it, and the survey itself is isCloud()-
  // gated on the front-end, so self-hosted deployments never generate a
  // response to forward. Feedback text is only forwarded on an explicit
  // "submitted" exit, matching the client contract. The 90-day re-survey window
  // is a display concern (the client just stops showing the survey), so every
  // response that arrives is forwarded. Fire-and-forget — a Slack failure must
  // never affect the user's request.
  if (status === "responded" && score !== undefined && NPS_SLACK_WEBHOOK) {
    void sendNpsResponseToSlack({
      score,
      feedback: disposition === "submitted" ? (feedback ?? "").trim() : "",
      email: req.email,
      disposition,
      supersedes,
      preview,
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
