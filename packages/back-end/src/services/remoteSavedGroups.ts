import { v4 as uuidv4 } from "uuid";
import { NO_ENVIRONMENT_BINDING } from "shared/permissions";
import {
  checkRemoteGroupCsvSample,
  parseRemoteGroupCsv,
  RemoteGroupCsvOptions,
} from "@growthbook/remote-saved-groups";
import {
  REMOTE_SAVED_GROUP_MAX_UPLOAD_BYTES,
  REMOTE_SAVED_GROUP_SAMPLE_BYTES,
} from "shared/util";
import type { SavedGroupInterface } from "shared/types/saved-group";
import type {
  ApiSavedGroup,
  ApiSavedGroupUpload,
  SavedGroupUploadLoad,
  SavedGroupUploadInterface,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  copyFile,
  deleteFile,
  getFileSize,
  getSignedUploadUrl,
  readFileRange,
  readFileStream,
} from "back-end/src/services/files";
import { queueValidateRemoteSavedGroupUpload } from "back-end/src/jobs/validateRemoteSavedGroupUpload";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";
import { auditDetailsCreate } from "back-end/src/services/audit";
import {
  assertRemoteSavedGroupAttribute,
  assertRemoteSavedGroupsEnabled,
  assertRemoteSavedGroupStorage,
} from "back-end/src/services/savedGroups";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

type FullContext = ReqContext | ApiReqContext;

/** The parts of a request context this service uses, so tests can supply only those. */
export type RemoteSavedGroupsContext = Pick<
  FullContext,
  "org" | "userId" | "auditLog"
> & {
  permissions: Pick<
    FullContext["permissions"],
    "canRevisionAction" | "throwPermissionError"
  >;
  models: {
    savedGroups: Pick<FullContext["models"]["savedGroups"], "getById">;
    savedGroupUploads: Pick<
      FullContext["models"]["savedGroupUploads"],
      | "create"
      | "delete"
      | "getById"
      | "getBySourceKey"
      | "getLatest"
      | "getLatestValidBySavedGroups"
      | "getPageBySavedGroup"
      | "getVersion"
      | "setStatus"
      | "upsertLoad"
    >;
  };
};
type Context = RemoteSavedGroupsContext;

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
    size: upload.size,
    dateCreated: upload.dateCreated.toISOString(),
    createdBy: upload.createdBy,
    status: upload.status,
    loads: (upload.loads ?? []).map((load) => ({
      ...load,
      dateUpdated: load.dateUpdated.toISOString(),
    })),
  };
}

/** A signed URL the caller uploads a CSV to, before creating an upload. */
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
    REMOTE_SAVED_GROUP_MAX_UPLOAD_BYTES,
    1,
  );
  return {
    signedUrl,
    fields: fields ?? null,
    fileKey,
    maxBytes: REMOTE_SAVED_GROUP_MAX_UPLOAD_BYTES,
    expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000),
  };
}

/**
 * Checks the start and end of an uploaded CSV, without reading the rest, and
 * returns its size. The loader handles anything the samples miss.
 */
function getCsvOptions(
  context: Context,
  group: SavedGroupInterface,
): RemoteGroupCsvOptions {
  const attributeKey = group.attributeKey ?? "";
  return {
    attributeKey,
    numeric:
      context.org.settings?.attributeSchema?.find(
        (a) => a.property === attributeKey,
      )?.datatype === "number",
  };
}

async function checkUploadedCsv(
  context: Context,
  group: SavedGroupInterface,
  fileKey: string,
): Promise<number> {
  const size = await getFileSize(fileKey);
  if (size === null) {
    throw new BadRequestError("Could not find the uploaded file");
  }
  if (size === 0) throw new BadRequestError("The file is empty");
  if (size > REMOTE_SAVED_GROUP_MAX_UPLOAD_BYTES) {
    throw new BadRequestError("The file is too large");
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
      throw new BadRequestError((e as Error).message);
    }
  });
  // Blank ends don't make a large file empty; the full check decides that.
  if (!idCount && samples.length === 1) {
    throw new BadRequestError("The file has no IDs");
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
    // Nothing was recorded yet, so the copy is only this request's, and the
    // staged file won't be used.
    deleteCopy();
    await deleteStagedFile(sourceKey);
    throw e;
  }

  let upload: SavedGroupUploadInterface;
  try {
    upload = await recordUpload(context, group, { sourceKey, fileKey, size });
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

/** Best-effort: a file left behind is removed by the cleanup job. */
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
    size,
  }: { sourceKey: string; fileKey: string; size: number },
): Promise<SavedGroupUploadInterface> {
  for (let attempt = 0; ; attempt++) {
    const latest = await context.models.savedGroupUploads.getLatest(group.id);
    try {
      return await context.models.savedGroupUploads.create({
        savedGroupId: group.id,
        version: (latest?.version ?? 0) + 1,
        sourceKey,
        fileKey,
        size,
        createdBy: context.userId || "",
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

/**
 * Checks a whole uploaded file, streaming it, and records the result. Run by
 * a job after each upload; does nothing once the upload has a result.
 */
export async function validateRemoteSavedGroupUpload(
  context: Context,
  uploadId: string,
): Promise<void> {
  const upload = await context.models.savedGroupUploads.getById(uploadId);
  if (!upload || upload.status.type !== "pending") return;
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

  const result = await parseRemoteGroupCsv(
    readFileStream(upload.fileKey),
    getCsvOptions(context, group),
  );
  await context.models.savedGroupUploads.setStatus(
    upload,
    result.type === "valid"
      ? { type: "valid", idCount: result.idCount }
      : result,
  );
}

export async function listRemoteSavedGroupUploads(
  context: Context,
  id: string,
  page: { limit: number; offset: number },
): Promise<{ uploads: ApiSavedGroupUpload[]; total: number }> {
  const group = await getRemoteSavedGroup(context, id);
  const { uploads, total } =
    await context.models.savedGroupUploads.getPageBySavedGroup(group.id, page);
  return { uploads: uploads.map(toApiSavedGroupUpload), total };
}

/**
 * Adds `latestUpload` to remote groups: the newest valid upload, which loaders
 * load. Pending and invalid uploads never reach them.
 */
export async function addLatestUploads(
  context: Context,
  savedGroups: ApiSavedGroup[],
): Promise<ApiSavedGroup[]> {
  const remoteIds = savedGroups
    .filter((g) => g.type === "remote")
    .map((g) => g.id);
  if (!remoteIds.length) return savedGroups;
  const latest =
    await context.models.savedGroupUploads.getLatestValidBySavedGroups(
      remoteIds,
    );
  return savedGroups.map((g) => {
    if (g.type !== "remote") return g;
    const upload = latest.get(g.id);
    return {
      ...g,
      latestUpload: upload
        ? {
            version: upload.version,
            dateCreated: upload.dateCreated.toISOString(),
          }
        : null,
    };
  });
}

/** Only valid uploads: pending and invalid ones never reach loaders. */
export async function getRemoteSavedGroupUpload(
  context: Context,
  id: string,
  version: number,
): Promise<SavedGroupUploadInterface> {
  const group = await getRemoteSavedGroup(context, id);
  const upload = await context.models.savedGroupUploads.getVersion(
    group.id,
    version,
  );
  if (!upload || upload.status.type !== "valid") {
    throw new NotFoundError("Could not find that upload");
  }
  return upload;
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

/** Removes a deleted group's uploads and their files, in batches. */
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
