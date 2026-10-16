import Agenda, { Job } from "agenda";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { validateRemoteSavedGroupUpload } from "back-end/src/services/remoteSavedGroups";
import { logger } from "back-end/src/util/logger";

const JOB_NAME = "validateRemoteSavedGroupUpload";
const MAX_ATTEMPTS = 5;
const RETRY_DELAY = "5 minutes";

type ValidateRemoteSavedGroupUploadJob = Job<{
  organization: string;
  uploadId: string;
  attempt?: number;
}>;

let agenda: Agenda;

/**
 * Registers the job that checks a remote Saved Group upload's whole file and
 * sets its status to `valid` or `invalid`. Queued for each upload by
 * `queueValidateRemoteSavedGroupUpload`. Storage errors leave the upload
 * `pending` and retry a few times.
 */
export default function (ag: Agenda) {
  agenda = ag;
  agenda.define(
    JOB_NAME,
    // Streaming a large file takes minutes, so the lock outlasts the default;
    // one at a time per process keeps it from competing with the API.
    { concurrency: 1, lockLimit: 1, lockLifetime: 60 * 60 * 1000 },
    async (job: ValidateRemoteSavedGroupUploadJob) => {
      const { organization, uploadId, attempt = 1 } = job.attrs.data;
      if (!organization || !uploadId) return;
      try {
        const context = await getContextForAgendaJobByOrgId(organization);
        await validateRemoteSavedGroupUpload(context, uploadId);
      } catch (e) {
        // Usually a storage error. The upload stays pending until a retry works.
        logger.error(
          { err: e, organization, uploadId, attempt },
          "Could not validate a remote Saved Group upload",
        );
        if (attempt < MAX_ATTEMPTS) {
          await agenda.schedule(RETRY_DELAY, JOB_NAME, {
            organization,
            uploadId,
            attempt: attempt + 1,
          });
        }
      }
    },
  );
}

export async function queueValidateRemoteSavedGroupUpload(
  organization: string,
  uploadId: string,
) {
  const job = agenda.create(JOB_NAME, {
    organization,
    uploadId,
  }) as ValidateRemoteSavedGroupUploadJob;
  job.unique({ uploadId, organization });
  job.schedule(new Date());
  await job.save();
}
