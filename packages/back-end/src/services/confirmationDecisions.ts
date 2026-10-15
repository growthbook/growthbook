import type { ConfirmationInterface } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import { dispatchInternal, HttpMethod } from "back-end/src/agent/dispatcher";
import { getContextForApiKeyIdInOrg } from "back-end/src/services/organizations";
import { encodeArmingApiKeyId } from "back-end/src/util/armingApiKeyId";
import { toApiConfirmation } from "back-end/src/services/confirmations";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { auditDetailsCreate } from "back-end/src/services/audit";

// The person a request is for decides it alone: a personal token's owner, or
// the member an org key names with Requested-By. Any member may confirm an org
// key's own requests: whoever can reach an agent using the key can already act
// through it, so the key's permissions govern the work, not the confirmer's.
// Orgs limit this by limiting who can use the key.
export function canDecide(
  context: ReqContext,
  c: ConfirmationInterface,
): boolean {
  const person = c.userId ?? c.requestedBy?.id ?? null;
  return person ? person === context.userId : true;
}

export async function getConfirmationForDecider(
  context: ReqContext,
  id: string,
) {
  const c = await context.models.confirmations.getById(id);
  if (!c) throw new NotFoundError("Could not find that confirmation");
  return c;
}

const failure = (e: unknown) => ({
  status: 500,
  body: { message: e instanceof Error ? e.message : String(e) },
});

export const STUCK_AFTER_MS = 5 * 60 * 1000;

async function auditDecision(
  context: ReqContext,
  c: ConfirmationInterface,
  event: "apiKey.confirm" | "apiKey.reject" | "apiKey.confirmFailure",
) {
  const key = await context.models.apiKeys.dangerousGetById(c.apiKeyId);
  await context.auditLog({
    event,
    entity: { object: "apiKey", id: c.apiKeyId, name: key?.description },
    details: auditDetailsCreate({
      confirmation: c.id,
      summary: c.summary,
      actions: c.actions,
      note: c.note,
    }),
  });
}

// Runs a claimed confirmation's request as its key and records the result.
// Once claimed it always finishes, so the agent polling it sees why.
async function runConfirmed(context: ReqContext, c: ConfirmationInterface) {
  const confirmations = context.models.confirmations;
  let response: { status: number; body: unknown };
  try {
    const requester = await getContextForApiKeyIdInOrg(
      context.org,
      encodeArmingApiKeyId(
        c.apiKeyId,
        c.assumedRole ? c.requestedBy?.id : undefined,
      ),
    );
    if (!requester) {
      await confirmations.updateWithCas(c.id, ["status"], () => ({
        status: "expired",
      }));
      throw new BadRequestError(
        "The key that made this request is gone, disabled or expired.",
      );
    }
    requester.confirmationId = c.id;
    requester.dispatchedRequest = { body: c.body, query: c.query };
    response = await dispatchInternal(
      requester,
      {
        method: c.method as HttpMethod,
        path: c.path,
        query: c.query,
        body: c.body,
      },
      { includeDeprecated: true },
    ).catch(failure);
  } catch (e) {
    await confirmations.updateWithCas(c.id, ["status"], (doc) =>
      doc.status === "running"
        ? { status: "completed", response: failure(e) }
        : null,
    );
    throw e;
  }
  const done = await confirmations.updateWithCas(c.id, ["status"], (doc) =>
    doc.status === "running" ? { status: "completed", response } : null,
  );
  return done ?? (await getConfirmationForDecider(context, c.id));
}

// The first decision wins. Confirm replays the held request as its original
// credential; the hold inside it sees `confirmationId` and lets the write through.
export async function decideConfirmation(
  context: ReqContext,
  id: string,
  decision: "confirm" | "reject",
  note?: string,
) {
  const c = await getConfirmationForDecider(context, id);
  if (!canDecide(context, c)) {
    context.permissions.throwPermissionError();
  }

  const confirmations = context.models.confirmations;
  const claimed = await confirmations.updateWithCas(id, ["status"], (doc) =>
    doc.status === "pending" && doc.expiresAt > new Date()
      ? {
          status: decision === "confirm" ? "running" : "rejected",
          decidedBy: context.userId ?? null,
          decidedAt: new Date(),
          note: note || null,
        }
      : null,
  );
  if (!claimed) {
    throw new BadRequestError(
      "This request was already decided or has expired.",
    );
  }
  try {
    await auditDecision(
      context,
      claimed,
      decision === "confirm" ? "apiKey.confirm" : "apiKey.reject",
    );
  } catch (e) {
    if (decision === "confirm") {
      await confirmations.updateWithCas(id, ["status"], (doc) =>
        doc.status === "running"
          ? { status: "completed", response: failure(e) }
          : null,
      );
    }
    throw e;
  }
  if (decision === "reject") return toApiConfirmation(claimed);
  return toApiConfirmation(await runConfirmed(context, claimed));
}

// A run still going this long was cut off, e.g. by a restart. It's marked
// failed rather than rerun, so nothing can apply twice; the agent can ask again.
export async function failStuckConfirmation(context: ReqContext, id: string) {
  const startedBefore = new Date(Date.now() - STUCK_AFTER_MS);
  const failed = await context.models.confirmations.updateWithCas(
    id,
    ["status"],
    (doc) =>
      doc.status === "running" &&
      doc.decidedAt &&
      doc.decidedAt <= startedBefore
        ? {
            status: "completed",
            response: failure(
              new Error(
                "This request was cut off before it finished. Check whether it took effect, then send it again.",
              ),
            ),
          }
        : null,
  );
  if (failed) await auditDecision(context, failed, "apiKey.confirmFailure");
}
