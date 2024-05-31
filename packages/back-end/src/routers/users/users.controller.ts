import { Response } from "express";
import { OrganizationInterface } from "@back-end/types/organization";
import { AuthRequest } from "../../types/AuthRequest";
import { usingOpenId } from "../../services/auth";
import { createUser, getUserByEmail } from "../../services/users";
import { findOrganizationsByMemberId } from "../../models/OrganizationModel";
import {
  addMemberFromSSOConnection,
  findVerifiedOrgsForNewUser,
  getContextFromReq,
  validateLoginMethod,
} from "../../services/organizations";
import { UserModel } from "../../models/UserModel";
import {
  deleteWatchedByEntity,
  getWatchedByUser,
  upsertWatch,
} from "../../models/WatchModel";
import { getFeature } from "../../models/FeatureModel";
import { getExperimentById } from "../../models/ExperimentModel";

function isValidWatchEntityType(type: string): boolean {
  if (type === "experiment" || type === "feature") {
    return true;
  } else {
    return false;
  }
}

export async function getUser(req: AuthRequest, res: Response) {
  // If using SSO, auto-create users in Mongo who we don't recognize yet
  if (!req.userId && usingOpenId()) {
    const user = await createUser({
      name: req.name || "",
      email: req.email,
      password: "",
      verified: req.verified,
    });
    req.userId = user.id;
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
  res: Response
) {
  const { name } = req.body;
  const { userId } = getContextFromReq(req);

  try {
    await UserModel.updateOne(
      {
        id: userId,
      },
      {
        $set: {
          name,
        },
      }
    );
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

export async function getWatchedItems(req: AuthRequest, res: Response) {
  const { org, userId } = getContextFromReq(req);
  try {
    const watch = await getWatchedByUser(org.id, userId);
    res.status(200).json({
      status: 200,
      experiments: watch?.experiments || [],
      features: watch?.features || [],
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function postWatchItem(
  req: AuthRequest<null, { type: string; id: string }>,
  res: Response
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
  res: Response
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
  if (orgs) {
    return res.status(200).json({
      organizations: orgs.map((org: OrganizationInterface) => {
        const currentUserIsPending = !!org?.pendingMembers?.find(
          (m) => m.id === user.id
        );
        const currentUserIsMember = !!org?.members?.find(
          (m) => m.id === user.id
        );
        return {
          id: org.id,
          name: org.name,
          members: org?.members?.length || 0,
          currentUserIsPending,
          currentUserIsMember,
        };
      }),
    });
  }
  res.status(200).json({
    message: "no org found",
  });
}
