import type { Revision } from "shared/enterprise";
import {
  referencedWebhookSecrets,
  SDKWebhookRevisionSnapshot,
} from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import {
  SoftWarningError,
  TerminalPublishError,
} from "back-end/src/util/errors";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import { getArmAcknowledgment } from "back-end/src/services/armGuards";

const GUARD = "webhook-secrets";

type MissingSecret = { id: string; warning: string };

// Secrets that the webhooks a change adds or edits reference but can't use:
// they don't exist, or aren't allowed for the webhook's origin. Such a webhook
// fails every send. Webhooks the change leaves alone are not judged.
export async function missingWebhookSecrets(
  context: Context,
  before: SDKWebhookRevisionSnapshot[],
  after: SDKWebhookRevisionSnapshot[],
): Promise<MissingSecret[]> {
  const was = new Map(before.map((w) => [w.id, w]));
  const missing: MissingSecret[] = [];
  for (const webhook of after) {
    const old = was.get(webhook.id);
    const text = `${webhook.endpoint} ${webhook.headers ?? ""}`;
    if (old && `${old.endpoint} ${old.headers ?? ""}` === text) continue;
    const keys = new Set(referencedWebhookSecrets(text));
    if (!keys.size || !URL.canParse(webhook.endpoint)) continue;
    const usable = await context.models.webhookSecrets.getUsableKeys(
      new URL(webhook.endpoint).origin,
    );
    for (const key of keys) {
      if (usable.has(key)) continue;
      missing.push({
        id: `${webhook.id}:${key}`,
        warning: `Webhook "${webhook.name}" references the secret "${key}", which doesn't exist or isn't allowed for its endpoint. It will fail to send until the secret is added.`,
      });
    }
  }
  return missing;
}

// For the REST publish handlers, which report every gate in one response.
export const webhookSecretGates = (missing: MissingSecret[]): PublishGate[] =>
  missing.length
    ? [
        {
          type: "missing-webhook-secret",
          severity: "warning",
          messages: missing.map((m) => m.warning),
          override: "ignoreWarnings",
          requiresPermission: null,
          resolution: null,
        },
      ]
    : [];

const warn = (missing: MissingSecret[], retry: string) =>
  new SoftWarningError(
    `${missing.map((m) => m.warning).join(" ")} Re-submit with ignoreWarnings to ${retry}.`,
    missing.map((m) => m.warning),
  );

// At a publish or a direct save. A scheduled publish has nobody to ask, so it
// answers to what was acknowledged when it was scheduled: a secret that went
// missing since stops it.
export async function assertWebhookSecrets(
  context: Context,
  before: SDKWebhookRevisionSnapshot[],
  after: SDKWebhookRevisionSnapshot[],
  scheduled?: Pick<Revision, "armAcknowledgments">,
): Promise<void> {
  const missing = await missingWebhookSecrets(context, before, after);
  if (!missing.length) return;
  if (scheduled) {
    const acknowledged = new Set(getArmAcknowledgment(scheduled, GUARD));
    if (missing.every((m) => acknowledged.has(m.id))) return;
    throw new TerminalPublishError(
      "SDK Connection publish blocked: a webhook references a secret that went missing since this publish was scheduled. Re-open the draft and re-confirm to publish.",
    );
  }
  if (!context.ignoreWarnings) throw warn(missing, "publish anyway");
}

// When a publish is scheduled: whoever schedules it acknowledges what is
// missing then, and the fire re-checks against that.
export async function captureWebhookSecretsAcknowledgment(
  context: Context,
  before: SDKWebhookRevisionSnapshot[],
  after: SDKWebhookRevisionSnapshot[],
): Promise<string[] | undefined> {
  const missing = await missingWebhookSecrets(context, before, after);
  if (!missing.length) return undefined;
  if (!context.ignoreWarnings) throw warn(missing, "acknowledge and schedule");
  return missing.map((m) => m.id).sort();
}
