import Agenda from "agenda";
import {
  addDays,
  EXPIRING_SOON_DAYS,
  getExpirationStatus,
} from "shared/api-key-expiration";
import { ApiKeyInterface } from "shared/types/apikey";
import { ApiKeyModel } from "back-end/src/models/ApiKeyModel";
import { createEvent } from "back-end/src/models/EventModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";

const JOB_NAME = "notifyApiKeyExpiration";

/**
 * Expiry itself is enforced at authentication from the stored date, so this
 * sweep exists only to announce the two transitions. It records the furthest
 * stage already announced on each key, which makes it idempotent and lets it
 * catch up rather than lose an event after downtime.
 */
const notifyApiKeyExpiration = async () => {
  const now = new Date();
  const keys = await ApiKeyModel.dangerousFindPendingExpirationNotices(
    addDays(now, EXPIRING_SOON_DAYS),
  );
  if (!keys.length) return;

  const byOrg = new Map<string, ApiKeyInterface[]>();
  for (const key of keys) {
    const existing = byOrg.get(key.organization);
    if (existing) {
      existing.push(key);
    } else {
      byOrg.set(key.organization, [key]);
    }
  }

  for (const [organization, orgKeys] of byOrg) {
    try {
      const context = await getContextForAgendaJobByOrgId(organization);
      for (const key of orgKeys) {
        const status = getExpirationStatus(key.expiresAt, now);
        const notice =
          status === "expired"
            ? "expired"
            : status === "expiring-soon"
              ? "expiring"
              : null;

        // An expiry pushed back out clears the record so the key can announce
        // itself again next time it approaches.
        if (!notice) {
          if (key.expirationNotice) {
            await ApiKeyModel.dangerousSetExpirationNotice(
              key.id || "",
              organization,
              null,
            );
          }
          continue;
        }
        if (notice === key.expirationNotice) continue;
        // Expiring is skipped for a key that lapsed between sweeps; only the
        // terminal event still means anything by then.
        if (notice === "expiring" && key.expirationNotice === "expired") {
          continue;
        }

        await createEvent({
          context,
          object: "apiKey",
          objectId: key.id,
          event: notice,
          data: {
            object: {
              id: key.id || "",
              description: key.description,
              kind: key.userId ? "personalAccessToken" : "secretApiKey",
              expiresAt: new Date(key.expiresAt as Date).toISOString(),
            },
          },
          containsSecrets: false,
          projects: [],
          tags: [],
          environments: [],
        });

        await ApiKeyModel.dangerousSetExpirationNotice(
          key.id || "",
          organization,
          notice,
        );
      }
    } catch (err) {
      // One bad organization must not stop the sweep for the rest.
      logger.error(
        { err, organization },
        "Failed to emit API key expiration events",
      );
    }
  }
};

export default async function addApiKeyExpirationJob(agenda: Agenda) {
  agenda.define(JOB_NAME, notifyApiKeyExpiration);

  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery("1 day");
  await job.save();
}
