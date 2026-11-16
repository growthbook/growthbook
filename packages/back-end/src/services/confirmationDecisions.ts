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
  // Once claimed it always finishes, so the agent polling it sees why.
  let response: { status: number; body: unknown };
  try {
    const key = await context.models.apiKeys.dangerousGetById(c.apiKeyId);
    await context.auditLog({
      event: decision === "confirm" ? "apiKey.confirm" : "apiKey.reject",
      entity: { object: "apiKey", id: c.apiKeyId, name: key?.description },
      details: auditDetailsCreate({
        confirmation: c.id,
        summary: c.summary,
        actions: c.actions,
        note: claimed.note,
      }),
    });
    if (decision === "reject") return toApiConfirmation(claimed);

    // An OAuth sign-in's token may have lapsed, so its request replays on
    // the grant.
    const requester = await getContextForApiKeyIdInOrg(
      context.org,
      encodeArmingApiKeyId(
        c.apiKeyId,
        c.assumedRole ? c.requestedBy?.id : undefined,
        c.oauthClientId && c.userId
          ? {
              clientId: c.oauthClientId,
              userId: c.userId,
              armedAt: c.dateCreated.getTime(),
            }
          : undefined,
      ),
    );
    if (!requester) {
      await confirmations.updateWithCas(id, ["status"], () => ({
        status: "expired",
      }));
      throw new BadRequestError(
        "The key that made this request is gone, disabled or expired.",
      );
    }
    // A member named only for attribution keeps the credit; the key keeps its role.
    if (
      c.requestedBy &&
      !c.assumedRole &&
      requester.auditUser?.type === "api_key"
    ) {
      requester.auditUser = {
        ...requester.auditUser,
        requestedBy: c.requestedBy,
      };
    }
    requester.confirmationId = id;
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
    await confirmations.updateWithCas(id, ["status"], (doc) =>
      doc.status === "running"
        ? { status: "completed", response: failure(e) }
        : null,
    );
    throw e;
  }

  const done = await confirmations.updateWithCas(id, ["status"], (doc) =>
    doc.status === "running" ? { status: "completed", response } : null,
  );
  return toApiConfirmation(
    done ?? (await getConfirmationForDecider(context, id)),
  );
}
