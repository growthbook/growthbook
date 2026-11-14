import type { NextFunction, Request, Response } from "express";
import type { Revision } from "shared/enterprise";
import type { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getAdapter } from "back-end/src/revisions";
import { scrubRevisionForViewer } from "back-end/src/revisions/scrub";

const needsScrub = (value: unknown): value is Revision => {
  const type = (value as Revision | null)?.target?.type;
  if (!type || !(value as Revision).target.snapshot) return false;
  try {
    return !!getAdapter(type).scrubForViewer;
  } catch {
    return false;
  }
};

// Every response that carries a revision sends it as its viewer may see it, so
// a new route can't forget to. A failure sends the error, never the revision.
export function scrubRevisionResponses(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const json = res.json.bind(res);
  res.json = (body) => {
    const one = body?.revision;
    const many: unknown[] = Array.isArray(body?.revisions)
      ? body.revisions
      : [];
    if (!needsScrub(one) && !many.some(needsScrub)) return json(body);

    (async () => {
      const context = getContextFromReq(req as AuthRequest);
      const scrub = (r: unknown) =>
        needsScrub(r) ? scrubRevisionForViewer(context, r) : r;
      return {
        ...body,
        ...(one !== undefined && { revision: await scrub(one) }),
        ...(many.length && { revisions: await Promise.all(many.map(scrub)) }),
      };
    })().then(json, next);
    return res;
  };
  next();
}
