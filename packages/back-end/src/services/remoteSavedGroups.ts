import { createHash } from "crypto";
import { isEqual, omit } from "lodash";
import { v4 as uuidv4 } from "uuid";
import { NO_ENVIRONMENT_BINDING } from "shared/permissions";
import { applyTopLevelPatchOps } from "shared/enterprise";
import {
  checkRemoteGroupCsvSample,
  parseRemoteGroupCsv,
  RemoteGroupCsvOptions,
} from "@growthbook/remote-saved-groups-csv-parser";
import { REMOTE_SAVED_GROUP_SAMPLE_BYTES } from "shared/util";
import type { SavedGroupInterface } from "shared/types/saved-group";
import type {
  ApiSavedGroup,
  ApiSavedGroupUpload,
  SavedGroupUploadDetails,
  SavedGroupUploadLoad,
  SavedGroupUploadInterface,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  copyFile,
  deleteFile,
  getFileInfo,
  getFileSize,
  getSignedDownloadUrl,
  getSignedUploadUrl,
  getStorageLocation,
  readFileRange,
  readFileStream,
} from "back-end/src/services/files";
import { queueValidateRemoteSavedGroupUpload } from "back-end/src/jobs/validateRemoteSavedGroupUpload";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";
import {
  auditDetailsCreate,
  auditDetailsDelete,
} from "back-end/src/services/audit";
import {
  assertRemoteSavedGroupAttribute,
  assertRemoteSavedGroupsEnabled,
  assertRemoteSavedGroupsLicensed,
  assertRemoteSavedGroupStorage,
} from "back-end/src/services/savedGroups";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import {
  gateOr5xx,
  makeBlockingGate,
  type PublishGate,
} from "back-end/src/revisions/publishGates";
import {
  IS_CLOUD,
  REMOTE_SAVED_GROUP_MAX_UPLOAD_MB,
} from "back-end/src/util/secrets";

const MAX_UPLOAD_BYTES = REMOTE_SAVED_GROUP_MAX_UPLOAD_MB * 1024 * 1024;

type FullContext = ReqContext | ApiReqContext;

/** The parts of a request context this service uses, so tests can supply only those. */
export type RemoteSavedGroupsContext = Pick<
  FullContext,
  "org" | "userId" | "actorId" | "auditLog" | "hasPremiumFeature"
> & {
  permissions: Pick<
    FullContext["permissions"],
    "canRevisionAction" | "throwPermissionError"
  >;
  models: {
    savedGroups: Pick<FullContext["models"]["savedGroups"], "getById">;
    revisions: Pick<FullContext["models"]["revisions"], "getOpenByTarget">;
    savedGroupUploads: Pick<
      FullContext["models"]["savedGroupUploads"],
      | "create"
      | "delete"
      | "getById"
      | "getBySourceKey"
      | "getLatest"
      | "getPageBySavedGroup"
      | "getVersion"
      | "getVersionIncludingDeleted"
      | "markDeleted"
      | "setStatus"
      | "upsertLoad"
    >;
  };
};
type Context = RemoteSavedGroupsContext;

const DOWNLOAD_URL_MINUTES = 15;

function storagePrefix(context: Context, savedGroupId: string) {
  return `${context.org.id}/remote-saved-groups/${savedGroupId}`;
}

/** Also checks the flag is on and the group is remote; 404 if it can't be read. */
async function getRemoteSavedGroup(
  context: Context,
  id: string,
): Promise<SavedGroupInterface> {
  assertRemoteSavedGroupsEnabled(context.org);
  const group = await context.models.savedGroups.getById(id);
  if (!group) throw new NotFoundError("Could not find Saved Group");
  if (group.type !== "remote") {
    throw new BadRequestError("This Saved Group is not a remote Saved Group");
  }
  return group;
}

/**
 * Uploads change membership right away, so they need publish access;
 * approvals don't apply to them yet. Load reports use the same check.
 */
function assertCanPublish(context: Context, group: SavedGroupInterface) {
  if (
    !context.permissions.canRevisionAction(
      "saved-group",
      "publish",
      group,
      NO_ENVIRONMENT_BINDING,
    )
  ) {
    context.permissions.throwPermissionError();
  }
}

async function getRemoteSavedGroupForUpload(context: Context, id: string) {
  const group = await getRemoteSavedGroup(context, id);
  assertCanPublish(context, group);
  assertRemoteSavedGroupsLicensed(context);
  if (group.archived) {
    throw new BadRequestError("Cannot upload to an archived Saved Group");
  }
  assertRemoteSavedGroupStorage();
  // The attribute can be removed or changed after the group is created.
  assertRemoteSavedGroupAttribute(context.org, group.attributeKey);
  return group;
}

export function toApiSavedGroupUpload(
  upload: SavedGroupUploadInterface,
): ApiSavedGroupUpload {
  return {
    savedGroupId: upload.savedGroupId,
    version: upload.version,
    fileName: upload.fileName ?? null,
    size: upload.size,
    sha256: upload.sha256 ?? null,
    dateCreated: upload.dateCreated.toISOString(),
    createdBy: upload.createdBy,
    status: upload.status,
    loads: (upload.loads ?? []).map((load) => ({
      ...load,
      dateUpdated: load.dateUpdated.toISOString(),
    })),
  };
}

export async function getRemoteSavedGroupUploadUrl(
  context: Context,
  id: string,
) {
  const group = await getRemoteSavedGroupForUpload(context, id);
  const fileKey = `${storagePrefix(context, group.id)}/staging/${uuidv4()}.csv`;
  const expiresInMinutes = 15;
  const { signedUrl, fields } = await getSignedUploadUrl(
    fileKey,
    "text/csv",
    expiresInMinutes,
    "private",
    MAX_UPLOAD_BYTES,
    1,
  );
  return {
    signedUrl,
    fields: fields ?? null,
    fileKey,
    maxBytes: MAX_UPLOAD_BYTES,
    expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000),
  };
}

/**
 * How a group's CSVs are parsed. An upload keeps the number mode it was
 * created with; new uploads take it from the attribute's current type.
 */
function getCsvOptions(
  context: Context,
  group: SavedGroupInterface,
  upload?: Pick<SavedGroupUploadInterface, "numeric">,
): RemoteGroupCsvOptions {
  const attributeKey = group.attributeKey ?? "";
  return {
    attributeKey,
    numeric:
      upload?.numeric ??
      context.org.settings?.attributeSchema?.find(
        (a) => a.property === attributeKey,
      )?.datatype === "number",
  };
}

/** Only confirmed content errors allow deleting the staged file. */
class InvalidRemoteSavedGroupUploadError extends BadRequestError {}

async function checkUploadedCsv(
  context: Context,
  group: SavedGroupInterface,
  fileKey: string,
): Promise<number> {
  const size = await getFileSize(fileKey);
  if (size === null) {
    throw new BadRequestError("Could not find the uploaded file");
  }
  if (size === 0)
    throw new InvalidRemoteSavedGroupUploadError("The file is empty");
  if (size > MAX_UPLOAD_BYTES) {
    throw new InvalidRemoteSavedGroupUploadError("The file is too large");
  }

  const csvOptions = getCsvOptions(context, group);
  const sampleBytes = REMOTE_SAVED_GROUP_SAMPLE_BYTES;
  const samples =
    size <= sampleBytes * 2
      ? [{ start: 0, end: size - 1, isStart: true, isEnd: true }]
      : [
          { start: 0, end: sampleBytes - 1, isStart: true, isEnd: false },
          {
            start: size - sampleBytes,
            end: size - 1,
            isStart: false,
            isEnd: true,
          },
        ];
  const contents = await Promise.all(
    samples.map((s) => readFileRange(fileKey, s.start, s.end)),
  );

  let idCount = 0;
  samples.forEach((s, i) => {
    try {
      idCount += checkRemoteGroupCsvSample(contents[i], {
        ...csvOptions,
        start: s.isStart,
        end: s.isEnd,
      }).idCount;
    } catch (e) {
      throw new InvalidRemoteSavedGroupUploadError((e as Error).message);
    }
  });
  // Blank ends don't make a large file empty; the full check decides that.
  if (!idCount && samples.length === 1) {
    throw new InvalidRemoteSavedGroupUploadError("The file has no IDs");
  }
  return size;
}

/**
 * Records a CSV as the group's next upload version, `pending` until a job
 * checks the whole file. The file is kept as uploaded; loaders trim and dedupe
 * it. The group document and SDK payloads don't change.
 *
 * The client can overwrite `fileKey` until its signed URL expires, so it's
 * copied first, and everything after uses the copy. The staged file is
 * deleted once the upload is recorded or rejected. Submitting the same file
 * again, at the same time or later, returns its existing upload, and queues
 * its check again if it's still pending.
 */
export async function createRemoteSavedGroupUpload(
  context: Context,
  id: string,
  sourceKey: string,
  fileName?: string,
): Promise<ApiSavedGroupUpload> {
  const group = await getRemoteSavedGroupForUpload(context, id);

  // Only this group's uploads, so the key can't point at other files.
  const prefix = storagePrefix(context, group.id);
  if (!sourceKey.startsWith(`${prefix}/staging/`) || sourceKey.includes("..")) {
    throw new BadRequestError("Invalid fileKey");
  }
  const existing =
    await context.models.savedGroupUploads.getBySourceKey(sourceKey);
  if (existing) return finishUpload(context, existing);

  const fileKey = `${prefix}/uploads/${uuidv4()}.csv`;
  try {
    await copyFile(sourceKey, fileKey);
  } catch {
    // Another request may have recorded this file and deleted it since.
    const recorded =
      await context.models.savedGroupUploads.getBySourceKey(sourceKey);
    if (recorded) return finishUpload(context, recorded);
    throw new BadRequestError("Could not find the uploaded file");
  }
  const deleteCopy = () =>
    deleteFile(fileKey).catch((err) =>
      logger.warn({ err }, "Could not delete a rejected Saved Group upload"),
    );

  let size: number;
  try {
    size = await checkUploadedCsv(context, group, fileKey);
  } catch (e) {
    // No record owns the copy yet. Keep the staged file on storage failures
    // so the client can retry without uploading it again.
    deleteCopy();
    if (e instanceof InvalidRemoteSavedGroupUploadError) {
      await deleteStagedFile(sourceKey);
    }
    throw e;
  }

  let upload: SavedGroupUploadInterface;
  try {
    upload = await recordUpload(context, group, {
      sourceKey,
      fileKey,
      fileName,
      size,
    });
  } catch (e) {
    // A failed insert may still have been saved, e.g. when its
    // acknowledgment is lost, so check before deleting the copy. Another
    // request may also have recorded this file first.
    let recorded: SavedGroupUploadInterface | null;
    try {
      recorded =
        await context.models.savedGroupUploads.getBySourceKey(sourceKey);
    } catch {
      // Can't tell; keep the copy for the cleanup job.
      throw e;
    }
    if (recorded?.fileKey !== fileKey) deleteCopy();
    if (!recorded) throw e;
    return finishUpload(context, recorded);
  }
  return finishUpload(context, upload);
}

async function deleteStagedFile(sourceKey: string): Promise<void> {
  await deleteFile(sourceKey).catch((err) =>
    logger.warn({ err }, "Could not delete a staged Saved Group upload"),
  );
}

/**
 * Audits a recorded upload, then queues its check while it's pending. If
 * either fails, the request fails and the upload stays pending, so loaders
 * never see an unaudited upload. Submitting the file again runs this again,
 * and jobs and audit events are unique per upload, so nothing repeats.
 */
async function finishUpload(
  context: Context,
  upload: SavedGroupUploadInterface,
): Promise<ApiSavedGroupUpload> {
  // Resubmitting a file after its upload was deleted doesn't bring it back.
  if (upload.dateDeleted) {
    throw new BadRequestError("This upload was deleted.");
  }
  // The upload has its own copy now. Resubmissions find it by `sourceKey`.
  await deleteStagedFile(upload.sourceKey);

  // A fixed id per upload: a retry after a lost acknowledgment, or a second
  // submission, fails as a duplicate instead of writing the event twice.
  try {
    await context.auditLog(
      {
        event: "savedGroup.uploaded",
        entity: { object: "savedGroup", id: upload.savedGroupId },
        details: auditDetailsCreate({
          version: upload.version,
          size: upload.size,
        }),
      },
      `aud_${upload.id}`,
    );
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
  }
  if (upload.status.type === "pending") {
    await queueValidateRemoteSavedGroupUpload(context.org.id, upload.id);
  }
  return toApiSavedGroupUpload(upload);
}

/**
 * Records an upload as the group's next version. Concurrent uploads can race
 * for a version number; the unique index rejects the loser, which takes the
 * next one. A duplicate `sourceKey` is rethrown for the caller.
 */
async function recordUpload(
  context: Context,
  group: SavedGroupInterface,
  {
    sourceKey,
    fileKey,
    fileName,
    size,
  }: {
    sourceKey: string;
    fileKey: string;
    fileName: string | undefined;
    size: number;
  },
): Promise<SavedGroupUploadInterface> {
  for (let attempt = 0; ; attempt++) {
    const latest = await context.models.savedGroupUploads.getLatest(group.id);
    try {
      return await context.models.savedGroupUploads.create({
        savedGroupId: group.id,
        version: (latest?.version ?? 0) + 1,
        sourceKey,
        fileKey,
        ...(fileName ? { fileName } : {}),
        size,
        numeric: getCsvOptions(context, group).numeric,
        createdBy: context.actorId,
        status: { type: "pending" },
      });
    } catch (e) {
      const versionTaken =
        isDuplicateKeyError(e) &&
        !(await context.models.savedGroupUploads.getBySourceKey(sourceKey));
      if (attempt >= 2 || !versionTaken) throw e;
    }
  }
}

export async function validateRemoteSavedGroupUpload(
  context: Context,
  uploadId: string,
): Promise<void> {
  const upload = await context.models.savedGroupUploads.getById(uploadId);
  if (!upload || upload.status.type !== "pending" || upload.dateDeleted) {
    return;
  }
  const group = await context.models.savedGroups.getById(upload.savedGroupId);
  if (!group) return;

  // Checked again here, since the attribute can change while this is queued.
  try {
    assertRemoteSavedGroupAttribute(context.org, group.attributeKey);
  } catch (e) {
    await context.models.savedGroupUploads.setStatus(upload, {
      type: "invalid",
      invalidLineCount: 0,
      errors: [(e as Error).message],
    });
    return;
  }

  // Hashed while it's parsed. The parser stops early on files that aren't
  // text, so the hash is kept only when the whole file was read.
  const hash = createHash("sha256");
  let readAll = false;
  const { fileKey } = upload;
  async function* hashed() {
    for await (const chunk of readFileStream(fileKey)) {
      hash.update(chunk);
      yield chunk;
    }
    readAll = true;
  }
  const result = await parseRemoteGroupCsv(
    hashed(),
    getCsvOptions(context, group, upload),
  );
  await context.models.savedGroupUploads.setStatus(
    upload,
    result.type === "valid"
      ? { type: "valid", idCount: result.idCount }
      : result,
    readAll ? hash.digest("hex") : undefined,
  );
}

/**
 * Marks a still-pending upload invalid when its file can't be checked, so it
 * doesn't stay pending for good.
 */
export async function failRemoteSavedGroupUploadValidation(
  context: Context,
  uploadId: string,
): Promise<void> {
  const upload = await context.models.savedGroupUploads.getById(uploadId);
  if (!upload || upload.status.type !== "pending") return;
  await context.models.savedGroupUploads.setStatus(upload, {
    type: "invalid",
    invalidLineCount: 0,
    errors: ["GrowthBook couldn't read the file. Upload it again."],
  });
}

/** A page of a group's uploads, newest first; only `versions` when given. */
export async function listRemoteSavedGroupUploads(
  context: Context,
  id: string,
  page: { limit: number; offset: number; versions?: number[] },
): Promise<{ uploads: ApiSavedGroupUpload[]; total: number }> {
  const group = await getRemoteSavedGroup(context, id);
  const { uploads, total } =
    await context.models.savedGroupUploads.getPageBySavedGroup(group.id, page);
  return { uploads: uploads.map(toApiSavedGroupUpload), total };
}

/**
 * The REST shape of saved groups, with `currentUpload` on remote groups: the
 * upload the group points to, which loaders load.
 */
export async function toApiSavedGroupsWithUploads(
  context: Context & {
    models: {
      savedGroups: Pick<FullContext["models"]["savedGroups"], "toApiInterface">;
    };
  },
  savedGroups: SavedGroupInterface[],
): Promise<ApiSavedGroup[]> {
  return Promise.all(
    savedGroups.map(async (g) => {
      const api = context.models.savedGroups.toApiInterface(g);
      if (g.type !== "remote") return api;
      const upload =
        g.currentUploadVersion === undefined
          ? null
          : await context.models.savedGroupUploads.getVersion(
              g.id,
              g.currentUploadVersion,
            );
      return {
        ...api,
        currentUpload: upload
          ? {
              version: upload.version,
              dateCreated: upload.dateCreated.toISOString(),
              numeric: getCsvOptions(context, g, upload).numeric,
            }
          : null,
      };
    }),
  );
}

/**
 * A remote group can only use a valid upload of its own, and only with an
 * Enterprise plan. Checked when the group is written and when a draft
 * proposes it, so a draft can't name a version that won't publish.
 */
export async function assertUsableUploadVersion(
  context: Context,
  savedGroupId: string,
  version: number,
): Promise<void> {
  assertRemoteSavedGroupsLicensed(context);
  const upload = await context.models.savedGroupUploads.getVersion(
    savedGroupId,
    version,
  );
  if (upload?.status.type !== "valid") {
    throw new BadRequestError(
      `Version ${version} is not a valid upload of this Saved Group`,
    );
  }
}

/**
 * Checks a remote group about to be written. Every write path runs this
 * (APIs, revisions, bulk publish plans), unlike request validators.
 * Compensation restores a state that was valid when it was written, so it
 * skips the flag, plan and upload checks.
 */
export async function assertValidRemoteSavedGroupWrite(
  context: Context,
  doc: SavedGroupInterface,
  previousDoc?: SavedGroupInterface,
  isCompensation = false,
): Promise<void> {
  // Archiving stays possible after the flag or the plan is turned off, for
  // cleanup.
  const onlyArchiving =
    !!previousDoc &&
    isEqual(
      omit(doc, ["archived", "dateUpdated"]),
      omit(previousDoc, ["archived", "dateUpdated"]),
    );
  if (!onlyArchiving && !isCompensation) {
    assertRemoteSavedGroupsEnabled(context.org);
    assertRemoteSavedGroupsLicensed(context);
  }
  if (doc.values?.length || doc.condition) {
    throw new BadRequestError(
      "Remote Saved Groups cannot have values or a condition",
    );
  }
  if (!previousDoc) {
    assertRemoteSavedGroupAttribute(context.org, doc.attributeKey);
  } else if (doc.attributeKey !== previousDoc.attributeKey) {
    // Loaders store IDs by attribute, so changing it would need a reload.
    throw new BadRequestError(
      "The attributeKey of a remote Saved Group cannot change",
    );
  }
  if (
    doc.currentUploadVersion !== undefined &&
    doc.currentUploadVersion !== previousDoc?.currentUploadVersion &&
    !isCompensation
  ) {
    await assertUsableUploadVersion(context, doc.id, doc.currentUploadVersion);
  }
}

/**
 * The remote group checks as a bulk publish gate, so a release that would
 * fail them at commit is blocked at plan time instead of rolling back.
 */
export async function collectRemoteSavedGroupGate(
  context: Context,
  proposed: SavedGroupInterface,
  current: SavedGroupInterface,
): Promise<PublishGate[]> {
  if (current.type !== "remote") return [];
  try {
    await assertValidRemoteSavedGroupWrite(context, proposed, current);
    return [];
  } catch (e) {
    return [
      gateOr5xx(e, (message) =>
        makeBlockingGate({ type: "remote-saved-group", messages: [message] }),
      ),
    ];
  }
}

/** An upload of any status. */
export async function findRemoteSavedGroupUpload(
  context: Context,
  id: string,
  version: number,
): Promise<SavedGroupUploadInterface> {
  const group = await getRemoteSavedGroup(context, id);
  const upload = await context.models.savedGroupUploads.getVersion(
    group.id,
    version,
  );
  if (!upload) throw new NotFoundError("Could not find that upload");
  return upload;
}

/** A valid upload, as loaders see it. */
export async function getRemoteSavedGroupUpload(
  context: Context,
  id: string,
  version: number,
): Promise<SavedGroupUploadInterface> {
  const upload = await findRemoteSavedGroupUpload(context, id, version);
  if (upload.status.type !== "valid") {
    throw new NotFoundError("Could not find that upload");
  }
  return upload;
}

/** An upload of any status, with what storage reports about its file. */
export async function getRemoteSavedGroupUploadDetails(
  context: Context,
  id: string,
  version: number,
): Promise<SavedGroupUploadDetails> {
  const upload = await findRemoteSavedGroupUpload(context, id, version);
  const file = await getFileInfo(upload.fileKey);
  return {
    upload: toApiSavedGroupUpload(upload),
    file: file && {
      ...file,
      lastModified: file.lastModified?.toISOString() ?? null,
    },
    // On Cloud the bucket is GrowthBook's own, so its paths aren't shown.
    storageLocation: IS_CLOUD ? null : getStorageLocation(upload.fileKey),
  };
}

/**
 * A short-lived URL to download an upload's file, of any status, under its
 * original name (or `<group id>-v<version>.csv` when it has none).
 */
export async function getRemoteSavedGroupUploadDownloadUrl(
  context: Context,
  id: string,
  version: number,
): Promise<string> {
  const upload = await findRemoteSavedGroupUpload(context, id, version);
  return getSignedDownloadUrl(
    upload.fileKey,
    upload.fileName ?? `${upload.savedGroupId}-v${upload.version}.csv`,
    DOWNLOAD_URL_MINUTES,
  );
}

/**
 * Deletes an upload, unless the live group or an open draft points to it. The
 * record is marked deleted rather than removed, so its version number isn't
 * reused. Each step can repeat, so retrying after a failure finishes the job.
 */
export async function deleteRemoteSavedGroupUpload(
  context: Context,
  id: string,
  version: number,
): Promise<void> {
  const group = await getRemoteSavedGroup(context, id);
  assertCanPublish(context, group);
  const upload =
    await context.models.savedGroupUploads.getVersionIncludingDeleted(
      group.id,
      version,
    );
  if (!upload) throw new NotFoundError("Could not find that upload");

  // A retry of a delete that already got this far skips the checks.
  if (!upload.dateDeleted) {
    if (group.currentUploadVersion === version) {
      throw new BadRequestError(
        "This is the group's current version, so it can't be deleted.",
      );
    }
    const drafts = await context.models.revisions.getOpenByTarget(
      "saved-group",
      group.id,
    );
    const inDraft = drafts.some((r) => {
      const proposed = applyTopLevelPatchOps(
        r.target.snapshot,
        r.target.proposedChanges,
      );
      return (
        "currentUploadVersion" in proposed &&
        proposed.currentUploadVersion === version
      );
    });
    if (inDraft) {
      throw new BadRequestError(
        "An open draft uses this version, so it can't be deleted.",
      );
    }
    await context.models.savedGroupUploads.markDeleted(upload);
  }

  // A fixed id, so a retry doesn't write the event twice.
  try {
    await context.auditLog(
      {
        event: "savedGroup.uploadDeleted",
        entity: { object: "savedGroup", id: group.id },
        details: auditDetailsDelete({
          version: upload.version,
          size: upload.size,
          fileName: upload.fileName ?? null,
        }),
      },
      `aud_${upload.id}_deleted`,
    );
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
  }
  // Missing files are ignored, so this can repeat too.
  await deleteFile(upload.fileKey);
}

/**
 * Records a loader's report for one data store. Archived groups still take
 * reports, since loaders keep serving them until they're deleted.
 */
export async function reportRemoteSavedGroupUploadLoad(
  context: Context,
  id: string,
  version: number,
  report: Omit<SavedGroupUploadLoad, "dateUpdated">,
): Promise<ApiSavedGroupUpload> {
  const group = await getRemoteSavedGroup(context, id);
  assertCanPublish(context, group);
  const upload = await context.models.savedGroupUploads.getVersion(
    group.id,
    version,
  );
  if (!upload) throw new NotFoundError("Could not find that upload");
  const updated = await context.models.savedGroupUploads.upsertLoad(upload, {
    ...report,
    dateUpdated: new Date(),
  });
  if (!updated) throw new NotFoundError("Could not find that upload");
  return toApiSavedGroupUpload(updated);
}

export async function deleteRemoteSavedGroupUploads(
  context: Context,
  savedGroupId: string,
): Promise<void> {
  for (;;) {
    // Always the first page, since each batch is deleted before the next.
    const { uploads } =
      await context.models.savedGroupUploads.getPageBySavedGroup(savedGroupId, {
        limit: 100,
        offset: 0,
        includeDeleted: true,
      });
    if (!uploads.length) return;
    for (const upload of uploads) {
      for (const key of [upload.fileKey, upload.sourceKey]) {
        await deleteFile(key).catch((e) =>
          logger.warn({ err: e }, "Could not delete a remote Saved Group file"),
        );
      }
      await context.models.savedGroupUploads.delete(upload);
    }
  }
}
