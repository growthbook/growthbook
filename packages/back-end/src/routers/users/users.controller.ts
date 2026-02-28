import { createHmac } from "node:crypto";
import { Response } from "express";
import { OrganizationInterface } from "shared/types/organization";
import { IS_CLOUD } from "back-end/src/util/secrets";
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
import {
  deleteWatchedByEntity,
  upsertWatch,
} from "back-end/src/models/WatchModel";
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

  // Filter out disabled organizations
  const enabledOrgs = orgs.filter((org) => !org.disabled);

  // Filter out orgs that the user can't log in to
  let lastError = "";
  const validOrgs = enabledOrgs.filter((org) => {
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

  await upsertWatch({
    userId,
    organization: org.id,
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
  const { org, userId } = getContextFromReq(req);
  const { type, id } = req.params;

  if (!isValidWatchEntityType(type)) {
    return res.status(400).json({
      status: 400,
      message:
        "Invalid entity type. Type must be either experiment or feature.",
    });
  }

  try {
    await deleteWatchedByEntity({
      organization: org.id,
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
