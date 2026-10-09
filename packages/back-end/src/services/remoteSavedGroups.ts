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
  assertRemoteSavedGroupsEnabled,
  assertRemoteSavedGroupStorage,
} from "back-end/src/services/savedGroups";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

type Context = ReqContext | ApiReqContext;

/** Where a group's uploaded files are stored. */
function storagePrefix(context: Context, savedGroupId: string) {
  return `${context.org.id}/remote-saved-groups/${savedGroupId}`;
}

/** A remote group the caller can read, or a 404. */
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

/** A remote group the caller can upload to. */
async function getRemoteSavedGroupForUpload(context: Context, id: string) {
  const group = await getRemoteSavedGroup(context, id);
  assertCanPublish(context, group);
  if (group.archived) {
    throw new BadRequestError("Cannot upload to an archived Saved Group");
  }
  assertRemoteSavedGroupStorage();
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
  const fileKey = `${storagePrefix(context, group.id)}/uploads/${uuidv4()}.csv`;
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
  if (!idCount) throw new BadRequestError("The file has no IDs");
  return size;
}

/**
 * Records a CSV as the group's next upload version, `pending` until a job
 * checks the whole file. The file is kept as uploaded; loaders trim and dedupe
 * it. The group document and SDK payloads don't change.
 */
export async function createRemoteSavedGroupUpload(
  context: Context,
  id: string,
  fileKey: string,
): Promise<ApiSavedGroupUpload> {
  const group = await getRemoteSavedGroupForUpload(context, id);

  // Only this group's uploads, so the key can't point at other files.
  const uploadsPrefix = `${storagePrefix(context, group.id)}/uploads/`;
  if (!fileKey.startsWith(uploadsPrefix) || fileKey.includes("..")) {
    throw new BadRequestError("Invalid fileKey");
  }
  // Failures delete the file, which must not take an earlier upload's.
  if (await context.models.savedGroupUploads.getByFileKey(fileKey)) {
    throw new BadRequestError("This file was already uploaded");
  }

  let upload: SavedGroupUploadInterface;
  try {
    upload = await recordUpload(context, group, fileKey);
  } catch (e) {
    deleteFile(fileKey).catch((err) =>
      logger.warn({ err }, "Could not delete a rejected Saved Group upload"),
    );
    throw e;
  }

  await queueValidateRemoteSavedGroupUpload(context.org.id, upload.id);

  // After the upload is recorded, so a failure here can't delete its file.
  await context
    .auditLog({
      event: "savedGroup.uploaded",
      entity: { object: "savedGroup", id: group.id },
      details: auditDetailsCreate({
        version: upload.version,
        size: upload.size,
      }),
    })
    .catch((err) =>
      logger.error({ err }, "Could not audit a remote Saved Group upload"),
    );
  return toApiSavedGroupUpload(upload);
}

/** Checks an uploaded file and records it as the group's next version. */
async function recordUpload(
  context: Context,
  group: SavedGroupInterface,
  fileKey: string,
): Promise<SavedGroupUploadInterface> {
  const size = await checkUploadedCsv(context, group, fileKey);
  // Concurrent uploads can race for a version number; the unique index
  // rejects the loser, which takes the next one.
  for (let attempt = 0; ; attempt++) {
    const latest = await context.models.savedGroupUploads.getLatest(group.id);
    try {
      return await context.models.savedGroupUploads.create({
        savedGroupId: group.id,
        version: (latest?.version ?? 0) + 1,
        fileKey,
        size,
        createdBy: context.userId || "",
        status: { type: "pending" },
      });
    } catch (e) {
      if (attempt >= 2 || !isDuplicateKeyError(e)) throw e;
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
): Promise<ApiSavedGroupUpload[]> {
  const group = await getRemoteSavedGroup(context, id);
  const uploads = await context.models.savedGroupUploads.getBySavedGroup(
    group.id,
  );
  return uploads.map(toApiSavedGroupUpload);
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

/** One upload, for the loader to download its file. */
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
  // Loaders only ever see valid uploads.
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

/** Removes a deleted group's uploads and their files. */
export async function deleteRemoteSavedGroupUploads(
  context: Context,
  savedGroupId: string,
): Promise<void> {
  const uploads =
    await context.models.savedGroupUploads.getBySavedGroup(savedGroupId);
  for (const upload of uploads) {
    await deleteFile(upload.fileKey).catch((e) =>
      logger.warn({ err: e }, "Could not delete a remote Saved Group version"),
    );
    await context.models.savedGroupUploads.delete(upload);
  }
}
