import type { Response } from "express";
import { routeConfirmation } from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getUserById } from "back-end/src/models/UserModel";
import {
  overridesIn,
  toApiConfirmation,
} from "back-end/src/services/confirmations";
import {
  canDecide,
  decideConfirmation,
  getConfirmationForDecider,
} from "back-end/src/services/confirmationDecisions";
import { allRoutes } from "back-end/src/api/api.router";

let coverage: Record<string, string[]> | null = null;

// The API calls each action can hold, read from the routes' own declarations.
export const getConfirmationActions = async (
  req: AuthRequest,
  res: Response<{ status: 200; coverage: Record<string, string[]> }>,
) => {
  if (!coverage) {
    const calls: Record<string, Set<string>> = {};
    for (const route of allRoutes) {
      if (!route.method || route.deprecated) continue;
      for (const action of routeConfirmation(
        route.method,
        route.tags,
        route.confirmation,
      )) {
        (calls[action] ??= new Set()).add(route.summary || route.path);
      }
    }
    coverage = Object.fromEntries(
      Object.entries(calls).map(([action, set]) => [action, [...set]]),
    );
  }
  res.status(200).json({ status: 200, coverage });
};

export const getConfirmation = async (
  req: AuthRequest<unknown, { id: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const c = await getConfirmationForDecider(context, req.params.id);
  const key = await context.models.apiKeys.dangerousGetById(c.apiKeyId);
  // Who confirms: a personal token's owner, or the member an org key assumes.
  const owner = c.userId ? await getUserById(c.userId) : null;
  // A personal token's request is its owner's alone.
  if (c.userId && c.userId !== context.userId) {
    context.permissions.throwPermissionError(
      `This request is for ${owner?.email ?? "someone else"}. Only they can see it.`,
    );
  }
  const person = owner ?? c.requestedBy;
  res.status(200).json({
    status: 200,
    confirmation: toApiConfirmation(c),
    links: c.links,
    notices: c.notices,
    lastAttemptAt: c.lastAttemptAt,
    request: { method: c.method, path: c.path, query: c.query, body: c.body },
    overrides: [
      ...new Set([
        ...overridesIn(c),
        ...c.actions
          .map(({ action }) => action)
          .filter((action) => action.startsWith("override.")),
      ]),
    ],
    sentOverrides: overridesIn(c),
    requester: {
      personal: !!c.userId && !c.assumedRole,
      person: person ? person.name || person.email : null,
      assumedRole: c.assumedRole,
      keyDescription: key?.description || null,
    },
    canDecide: canDecide(context, c),
  });
};

const decide =
  (decision: "confirm" | "reject") =>
  async (
    req: AuthRequest<{ note?: string }, { id: string }>,
    res: Response,
  ) => {
    const confirmation = await decideConfirmation(
      getContextFromReq(req),
      req.params.id,
      decision,
      req.body.note,
    );
    res.status(200).json({ status: 200, confirmation });
  };

export const postConfirm = decide("confirm");
export const postReject = decide("reject");
