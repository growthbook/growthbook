import type { Response } from "express";
import { routeConfirmation } from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getUserById } from "back-end/src/models/UserModel";
import { toApiConfirmation } from "back-end/src/services/confirmations";
import {
  canDecide,
  decideConfirmation,
  getConfirmationForDecider,
} from "back-end/src/services/confirmationDecisions";
import { allRoutes } from "back-end/src/api/api.router";

let coverage: Record<string, string[]> | null = null;

// The API calls each label can hold, read from the routes' own declarations.
export const getConfirmationLabels = async (
  req: AuthRequest,
  res: Response<{ status: 200; coverage: Record<string, string[]> }>,
) => {
  if (!coverage) {
    const calls: Record<string, Set<string>> = {};
    for (const route of allRoutes) {
      if (!route.method || route.deprecated) continue;
      for (const label of routeConfirmation(
        route.method,
        route.tags,
        route.confirmation,
      )) {
        (calls[label] ??= new Set()).add(route.summary || route.path);
      }
    }
    coverage = Object.fromEntries(
      Object.entries(calls).map(([label, set]) => [label, [...set]]),
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
  const person = owner ?? c.requestedBy;
  res.status(200).json({
    status: 200,
    confirmation: toApiConfirmation(c),
    links: c.links,
    request: { method: c.method, path: c.path, query: c.query, body: c.body },
    requester: {
      personal: !!c.userId && !c.assumedRole,
      person: person ? person.name || person.email : null,
      assumedRole: c.assumedRole,
      keyDescription: key?.description || null,
    },
    forEmail: owner && c.userId !== context.userId ? owner.email : null,
    canDecide: canDecide(context, c),
  });
};

export const postConfirm = async (
  req: AuthRequest<unknown, { id: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const confirmation = await decideConfirmation(
    context,
    req.params.id,
    "confirm",
  );
  res.status(200).json({ status: 200, confirmation });
};

export const postReject = async (
  req: AuthRequest<{ note?: string }, { id: string }>,
  res: Response,
) => {
  const context = getContextFromReq(req);
  const confirmation = await decideConfirmation(
    context,
    req.params.id,
    "reject",
    req.body.note,
  );
  res.status(200).json({ status: 200, confirmation });
};
