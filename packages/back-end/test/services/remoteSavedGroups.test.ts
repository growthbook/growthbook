import { createHash } from "crypto";
import type { OrganizationInterface } from "shared/types/organization";
import type { SavedGroupInterface } from "shared/types/saved-group";
import type {
  JsonPatchOperation,
  Revision,
  SavedGroupUploadInterface,
} from "shared/validators";
import {
  copyFile,
  deleteFile,
  getFileInfo,
  getFileSize,
  getSignedDownloadUrl,
  readFileRange,
  readFileStream,
} from "back-end/src/services/files";
import { queueValidateRemoteSavedGroupUpload } from "back-end/src/jobs/validateRemoteSavedGroupUpload";
import { BadRequestError } from "back-end/src/util/errors";
import {
  assertUsableUploadVersion,
  collectRemoteSavedGroupGate,
  createRemoteSavedGroupUpload,
  deleteRemoteSavedGroupUpload,
  deleteRemoteSavedGroupUploads,
  failRemoteSavedGroupUploadValidation,
  getRemoteSavedGroupUpload,
  getRemoteSavedGroupUploadDetails,
  getRemoteSavedGroupUploadDownloadUrl,
  getRemoteSavedGroupUploadUrl,
  listRemoteSavedGroupUploads,
  RemoteSavedGroupsContext,
  toApiSavedGroupsWithUploads,
  validateRemoteSavedGroupUpload,
} from "back-end/src/services/remoteSavedGroups";

jest.mock("back-end/src/services/files", () => ({
  copyFile: jest.fn(),
  deleteFile: jest.fn(),
  getFileInfo: jest.fn(),
  getFileSize: jest.fn(),
  getSignedDownloadUrl: jest.fn(),
  getSignedUploadUrl: jest.fn(),
  getStorageLocation: (key: string) => `s3://bucket/${key}`,
  readFileRange: jest.fn(),
  readFileStream: jest.fn(),
}));
jest.mock("back-end/src/jobs/validateRemoteSavedGroupUpload", () => ({
  queueValidateRemoteSavedGroupUpload: jest.fn(),
}));
// An import cycle runs this factory twice, so both copies share one mock
const mockAssertRemoteSavedGroupsEnabled = jest.fn();
jest.mock("back-end/src/services/savedGroups", () => ({
  ...jest.requireActual("back-end/src/services/savedGroups"),
  assertRemoteSavedGroupsEnabled: (
    ...args: Parameters<typeof mockAssertRemoteSavedGroupsEnabled>
  ) => mockAssertRemoteSavedGroupsEnabled(...args),
  assertRemoteSavedGroupStorage: jest.fn(),
}));

// In-memory storage behind the mocked file functions
let files: Map<string, Buffer>;
const stagingKey = (name: string) =>
  `org_1/remote-saved-groups/grp_1/staging/${name}.csv`;

const group: SavedGroupInterface = {
  id: "grp_1",
  organization: "org_1",
  groupName: "VIP",
  owner: "",
  type: "remote",
  attributeKey: "user_id",
  dateCreated: new Date(),
  dateUpdated: new Date(),
};

// An open draft of `snapshot` with the given changes
function makeDraft(
  snapshot: SavedGroupInterface,
  proposedChanges: JsonPatchOperation[],
): Revision {
  return {
    id: "rev_1",
    authorId: "u_1",
    target: { type: "saved-group", id: snapshot.id, snapshot, proposedChanges },
    status: "draft",
    reviews: [],
    activityLog: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    organization: snapshot.organization,
  };
}

const duplicateKeyError = () =>
  Object.assign(new Error("E11000 duplicate key"), { code: 11000 });

// A context with an upload store that enforces the model's unique indexes.
// `currentUploadVersion` is the live group's; `draftVersions` are the versions
// its open drafts point to.
function makeContext({
  currentUploadVersion,
  draftVersions = [],
}: { currentUploadVersion?: number; draftVersions?: number[] } = {}) {
  const liveGroup: SavedGroupInterface = { ...group, currentUploadVersion };
  const uploads: SavedGroupUploadInterface[] = [];
  // Audit events by id, unique like the audit collection
  const audits = new Map<string, unknown>();
  let nextId = 0;
  const org: OrganizationInterface = {
    id: "org_1",
    url: "",
    dateCreated: new Date(),
    name: "Org",
    ownerEmail: "",
    members: [],
    invites: [],
    settings: {
      attributeSchema: [{ property: "user_id", datatype: "string" }],
    },
  };
  const context: RemoteSavedGroupsContext = {
    org,
    userId: "u_1",
    actorId: "u_1",
    hasPremiumFeature: (feature) => feature === "large-saved-groups",
    auditLog: jest.fn(async (data, id) => {
      if (id && audits.has(id)) throw duplicateKeyError();
      audits.set(id ?? `aud_${audits.size}`, data);
    }),
    permissions: {
      canRevisionAction: () => true,
      throwPermissionError: () => {
        throw new Error("forbidden");
      },
    },
    models: {
      savedGroups: {
        getById: async (id) => (id === liveGroup.id ? liveGroup : null),
      },
      revisions: {
        getOpenByTarget: async () =>
          draftVersions.map((version) =>
            makeDraft(liveGroup, [
              {
                op: "replace",
                path: "/currentUploadVersion",
                value: version,
              },
            ]),
          ),
      },
      savedGroupUploads: {
        create: async (props) => {
          // Yield first, like a database round trip, so concurrent calls race
          await Promise.resolve();
          if (
            uploads.some(
              (u) =>
                u.sourceKey === props.sourceKey ||
                (u.savedGroupId === props.savedGroupId &&
                  u.version === props.version),
            )
          ) {
            throw duplicateKeyError();
          }
          const upload: SavedGroupUploadInterface = {
            ...props,
            id: `sgu_${nextId++}`,
            organization: org.id,
            dateCreated: new Date(),
            dateUpdated: new Date(),
          };
          uploads.push(upload);
          return upload;
        },
        delete: async (doc) => {
          uploads.splice(uploads.indexOf(doc), 1);
          return doc;
        },
        getById: async (id) => uploads.find((u) => u.id === id) ?? null,
        getBySourceKey: async (sourceKey) =>
          uploads.find((u) => u.sourceKey === sourceKey) ?? null,
        getLatest: async (savedGroupId) =>
          uploads
            .filter((u) => u.savedGroupId === savedGroupId)
            .sort((a, b) => b.version - a.version)[0] ?? null,
        getPageBySavedGroup: async (
          savedGroupId,
          { limit, offset, includeDeleted },
        ) => {
          const matching = uploads
            .filter(
              (u) =>
                u.savedGroupId === savedGroupId &&
                (includeDeleted || !u.dateDeleted),
            )
            .sort((a, b) => b.version - a.version);
          return {
            uploads: matching.slice(offset, offset + limit),
            total: matching.length,
          };
        },
        getVersion: async (savedGroupId, version) =>
          uploads.find(
            (u) =>
              u.savedGroupId === savedGroupId &&
              u.version === version &&
              !u.dateDeleted,
          ) ?? null,
        getVersionIncludingDeleted: async (savedGroupId, version) =>
          uploads.find(
            (u) => u.savedGroupId === savedGroupId && u.version === version,
          ) ?? null,
        markDeleted: async (upload) => {
          const stored = uploads.find((u) => u.id === upload.id);
          if (stored && !stored.dateDeleted) stored.dateDeleted = new Date();
        },
        setStatus: async (upload, status, sha256) => {
          const stored = uploads.find((u) => u.id === upload.id);
          if (stored?.status.type === "pending") {
            stored.status = status;
            if (sha256) stored.sha256 = sha256;
          }
        },
        upsertLoad: async () => null,
      },
    },
  };
  return { context, uploads, audits };
}

beforeEach(() => {
  jest.clearAllMocks();
  files = new Map();
  jest.mocked(copyFile).mockImplementation(async (src, dest) => {
    const contents = files.get(src);
    if (!contents) throw new Error("NoSuchKey");
    files.set(dest, Buffer.from(contents));
  });
  jest.mocked(deleteFile).mockImplementation(async (key) => {
    files.delete(key);
  });
  jest
    .mocked(getFileSize)
    .mockImplementation(async (key) => files.get(key)?.length ?? null);
  jest
    .mocked(readFileRange)
    .mockImplementation(async (key, start, end) =>
      (files.get(key) ?? Buffer.alloc(0)).subarray(start, end + 1),
    );
  jest.mocked(readFileStream).mockImplementation(async function* (key) {
    yield files.get(key) ?? Buffer.alloc(0);
  });
});

describe("createRemoteSavedGroupUpload", () => {
  it("copies the file and records a pending upload", async () => {
    const { context, uploads } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\nu2\n"));

    const upload = await createRemoteSavedGroupUpload(
      context,
      "grp_1",
      stagingKey("a"),
    );

    expect(upload).toMatchObject({ version: 1, status: { type: "pending" } });
    expect(uploads[0]).toMatchObject({ createdBy: "u_1", numeric: false });
    expect(uploads[0].sourceKey).toBe(stagingKey("a"));
    expect(uploads[0].fileKey).toMatch(
      /^org_1\/remote-saved-groups\/grp_1\/uploads\/.+\.csv$/,
    );
    expect(files.get(uploads[0].fileKey)?.toString()).toBe("u1\nu2\n");
    expect(files.has(stagingKey("a"))).toBe(false);
    expect(queueValidateRemoteSavedGroupUpload).toHaveBeenCalledWith(
      "org_1",
      uploads[0].id,
    );
    expect(context.auditLog).toHaveBeenCalledTimes(1);
  });

  it("needs an Enterprise plan", async () => {
    const { context, uploads } = makeContext();
    context.hasPremiumFeature = () => false;
    files.set(stagingKey("a"), Buffer.from("u1\n"));

    await expect(
      getRemoteSavedGroupUploadUrl(context, "grp_1"),
    ).rejects.toThrow("require an Enterprise plan");
    await expect(
      createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a")),
    ).rejects.toThrow("require an Enterprise plan");
    expect(uploads).toHaveLength(0);
  });

  it("keeps the copy unchanged when the client overwrites its file", async () => {
    const { context, uploads } = makeContext();
    files.set(stagingKey("a"), Buffer.from("acct_alice\n"));
    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));

    files.set(stagingKey("a"), Buffer.from("acct_bob\n"));

    expect(files.get(uploads[0].fileKey)?.toString()).toBe("acct_alice\n");
  });

  it("rejects a key outside the group's staging folder", async () => {
    const { context } = makeContext();
    await expect(
      createRemoteSavedGroupUpload(
        context,
        "grp_1",
        "org_1/remote-saved-groups/grp_1/uploads/x.csv",
      ),
    ).rejects.toThrow("Invalid fileKey");
  });

  it("returns the existing upload when a file is submitted again", async () => {
    const { context, uploads } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    const first = await createRemoteSavedGroupUpload(
      context,
      "grp_1",
      stagingKey("a"),
    );

    const again = await createRemoteSavedGroupUpload(
      context,
      "grp_1",
      stagingKey("a"),
    );

    expect(again.version).toBe(first.version);
    expect(uploads).toHaveLength(1);
    expect(copyFile).toHaveBeenCalledTimes(1);
    // Still pending, so its check is queued again
    expect(queueValidateRemoteSavedGroupUpload).toHaveBeenCalledTimes(2);
  });

  it("doesn't queue a finished upload again", async () => {
    const { context, uploads } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));
    uploads[0].status = { type: "valid", idCount: 1 };

    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));

    expect(queueValidateRemoteSavedGroupUpload).toHaveBeenCalledTimes(1);
  });

  it("keeps the copy when a failed insert was actually saved", async () => {
    const { context, uploads, audits } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    const create = context.models.savedGroupUploads.create;
    context.models.savedGroupUploads.create = async (props) => {
      await create(props);
      throw new Error("connection reset before the acknowledgment");
    };

    const upload = await createRemoteSavedGroupUpload(
      context,
      "grp_1",
      stagingKey("a"),
    );

    expect(upload.version).toBe(1);
    expect([...files.keys()]).toEqual([uploads[0].fileKey]);
    expect(queueValidateRemoteSavedGroupUpload).toHaveBeenCalledTimes(1);
    expect(audits.size).toBe(1);
  });

  it("keeps the copy when it can't tell whether the insert was saved", async () => {
    const { context } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    context.models.savedGroupUploads.create = async () => {
      throw new Error("timeout");
    };
    const getBySourceKey = context.models.savedGroupUploads.getBySourceKey;
    let calls = 0;
    context.models.savedGroupUploads.getBySourceKey = async (key) => {
      if (calls++) throw new Error("database down");
      return getBySourceKey(key);
    };

    await expect(
      createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a")),
    ).rejects.toThrow("timeout");
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("deletes the copy when a failed insert wasn't saved", async () => {
    const { context } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    context.models.savedGroupUploads.create = async () => {
      throw new Error("validation failed");
    };

    await expect(
      createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a")),
    ).rejects.toThrow("validation failed");
    expect([...files.keys()]).toEqual([stagingKey("a")]);
  });

  it("audits each upload once, even when queueing fails and it's retried", async () => {
    const { context, audits } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    jest
      .mocked(queueValidateRemoteSavedGroupUpload)
      .mockRejectedValueOnce(new Error("queue down"));

    await expect(
      createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a")),
    ).rejects.toThrow("queue down");
    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));
    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));

    expect(audits.size).toBe(1);
  });

  it("writes the audit event once when its acknowledgment was lost", async () => {
    const { context, audits } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    const auditLog = context.auditLog;
    jest.mocked(auditLog).mockImplementationOnce(async (data, id) => {
      audits.set(id ?? "", data);
      throw new Error("connection reset before the acknowledgment");
    });

    await expect(
      createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a")),
    ).rejects.toThrow();
    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));

    expect(audits.size).toBe(1);
  });

  it("fails without queueing the check when the audit fails, and retries both", async () => {
    const { context, audits } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    jest
      .mocked(context.auditLog)
      .mockRejectedValueOnce(new Error("audit down"));

    await expect(
      createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a")),
    ).rejects.toThrow("audit down");
    expect(audits.size).toBe(0);
    expect(queueValidateRemoteSavedGroupUpload).not.toHaveBeenCalled();
    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));

    expect(audits.size).toBe(1);
    expect(queueValidateRemoteSavedGroupUpload).toHaveBeenCalledTimes(1);
  });

  it("recovers when queueing the check failed", async () => {
    const { context, uploads } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    jest
      .mocked(queueValidateRemoteSavedGroupUpload)
      .mockRejectedValueOnce(new Error("queue down"));

    await expect(
      createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a")),
    ).rejects.toThrow("queue down");
    expect(uploads).toHaveLength(1);

    const retried = await createRemoteSavedGroupUpload(
      context,
      "grp_1",
      stagingKey("a"),
    );
    expect(retried.status).toEqual({ type: "pending" });
    expect(queueValidateRemoteSavedGroupUpload).toHaveBeenLastCalledWith(
      "org_1",
      uploads[0].id,
    );
  });

  it("records one upload for concurrent submissions, deleting only the loser's copy", async () => {
    const { context, uploads } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));

    const results = await Promise.all([
      createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a")),
      createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a")),
    ]);

    expect(uploads).toHaveLength(1);
    expect(results[0].version).toBe(1);
    expect(results[1].version).toBe(1);
    expect([...files.keys()]).toEqual([uploads[0].fileKey]);
    expect(deleteFile).not.toHaveBeenCalledWith(uploads[0].fileKey);
  });

  it("returns the recorded upload when another request deleted the staged file first", async () => {
    const { context, uploads } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));
    // This request looked before the other one recorded the upload
    const getBySourceKey = context.models.savedGroupUploads.getBySourceKey;
    context.models.savedGroupUploads.getBySourceKey = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockImplementation(getBySourceKey);

    const upload = await createRemoteSavedGroupUpload(
      context,
      "grp_1",
      stagingKey("a"),
    );

    expect(upload.version).toBe(1);
    expect(uploads).toHaveLength(1);
  });

  it("takes the next version when another upload claims one first", async () => {
    const { context, uploads } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    files.set(stagingKey("b"), Buffer.from("u2\n"));

    await Promise.all([
      createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a")),
      createRemoteSavedGroupUpload(context, "grp_1", stagingKey("b")),
    ]);

    expect(uploads.map((u) => u.version).sort()).toEqual([1, 2]);
  });

  it.each(["size", "missing size", "range"])(
    "keeps the staged file when the %s read fails, so submission can be retried",
    async (failure) => {
      const { context, uploads } = makeContext();
      const sourceKey = stagingKey("a");
      files.set(sourceKey, Buffer.from("u1\n"));
      if (failure === "size") {
        jest
          .mocked(getFileSize)
          .mockRejectedValueOnce(new Error("storage down"));
      } else if (failure === "missing size") {
        // The storage helper returns null for failed HEAD requests too.
        jest.mocked(getFileSize).mockResolvedValueOnce(null);
      } else {
        jest
          .mocked(readFileRange)
          .mockRejectedValueOnce(new Error("storage down"));
      }

      await expect(
        createRemoteSavedGroupUpload(context, "grp_1", sourceKey),
      ).rejects.toThrow();
      expect(uploads).toHaveLength(0);
      expect([...files.keys()]).toEqual([sourceKey]);
      expect(queueValidateRemoteSavedGroupUpload).not.toHaveBeenCalled();

      await createRemoteSavedGroupUpload(context, "grp_1", sourceKey);
      expect(uploads).toHaveLength(1);
      expect(files.get(uploads[0].fileKey)?.toString()).toBe("u1\n");
      expect(files.has(sourceKey)).toBe(false);
    },
  );

  it("deletes the copy and staged file when the CSV is invalid", async () => {
    const { context, uploads } = makeContext();
    files.set(stagingKey("a"), Buffer.from("a,b\n"));

    await expect(
      createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a")),
    ).rejects.toThrow("more than one column");

    expect(uploads).toHaveLength(0);
    expect(files.size).toBe(0);
  });

  it("leaves a file with blank ends to the full check", async () => {
    const { context, uploads } = makeContext();
    const blank = "\n".repeat(70 * 1024);
    files.set(stagingKey("a"), Buffer.from(`${blank}u1\n${blank}`));

    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));

    expect(uploads[0].status).toEqual({ type: "pending" });
  });

  it("rejects uploads when the group's attribute is no longer supported", async () => {
    const { context } = makeContext();
    context.org.settings = {
      attributeSchema: [{ property: "user_id", datatype: "secureString" }],
    };
    files.set(stagingKey("a"), Buffer.from("u1\n"));

    await expect(
      createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a")),
    ).rejects.toThrow("string or number attributes");
  });
});

describe("validateRemoteSavedGroupUpload", () => {
  async function pendingUpload(csv: string) {
    const { context, uploads } = makeContext();
    files.set(stagingKey("a"), Buffer.from(csv));
    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));
    return { context, upload: uploads[0] };
  }

  it("marks a good file valid and records its SHA-256", async () => {
    const csv = "user_id\nu1\nu2\nu1\n";
    const { context, upload } = await pendingUpload(csv);
    await validateRemoteSavedGroupUpload(context, upload.id);
    expect(upload.status).toEqual({ type: "valid", idCount: 3 });
    expect(upload.sha256).toBe(createHash("sha256").update(csv).digest("hex"));
  });

  it("records no hash when it stops before the end of a binary file", async () => {
    // A null byte past the sampled start and end, so the full check finds it
    const lines = Array.from({ length: 30000 }, (_, i) => `user_${i}`);
    lines[15000] = "bad\u0000line";
    const { context, upload } = await pendingUpload(lines.join("\n"));
    jest.mocked(readFileStream).mockImplementation(async function* () {
      const contents = Buffer.from(lines.join("\n"));
      yield contents.subarray(0, 200000);
      yield contents.subarray(200000);
    });
    await validateRemoteSavedGroupUpload(context, upload.id);
    expect(upload.status.type).toBe("invalid");
    expect(upload.sha256).toBeUndefined();
  });

  it("marks a bad file invalid", async () => {
    // Large enough that the sample check doesn't see the middle
    const lines = Array.from({ length: 30000 }, (_, i) => `user_${i}`);
    lines[15000] = "u2,u3";
    const { context, upload } = await pendingUpload(lines.join("\n"));
    await validateRemoteSavedGroupUpload(context, upload.id);
    expect(upload.status).toMatchObject({
      type: "invalid",
      invalidLineCount: 1,
    });
  });

  it("marks the upload invalid if the attribute changed while queued", async () => {
    const { context, upload } = await pendingUpload("u1\n");
    context.org.settings = { attributeSchema: [] };
    await validateRemoteSavedGroupUpload(context, upload.id);
    expect(upload.status).toEqual({
      type: "invalid",
      invalidLineCount: 0,
      errors: ["Unknown attributeKey"],
    });
  });

  it("parses with the number mode the upload was created with", async () => {
    const { context, upload } = await pendingUpload("abc\n");
    context.org.settings = {
      attributeSchema: [{ property: "user_id", datatype: "number" }],
    };
    await validateRemoteSavedGroupUpload(context, upload.id);
    expect(upload.status).toEqual({ type: "valid", idCount: 1 });
  });

  it("leaves a finished upload alone", async () => {
    const { context, upload } = await pendingUpload("u1\n");
    upload.status = { type: "valid", idCount: 1 };
    await validateRemoteSavedGroupUpload(context, upload.id);
    expect(readFileStream).not.toHaveBeenCalled();
  });
});

describe("failRemoteSavedGroupUploadValidation", () => {
  async function pendingUpload() {
    const { context, uploads } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));
    return { context, upload: uploads[0] };
  }

  it("marks a pending upload invalid", async () => {
    const { context, upload } = await pendingUpload();
    await failRemoteSavedGroupUploadValidation(context, upload.id);
    expect(upload.status).toEqual({
      type: "invalid",
      invalidLineCount: 0,
      errors: ["GrowthBook couldn't read the file. Upload it again."],
    });
  });

  it("leaves a finished upload alone", async () => {
    const { context, upload } = await pendingUpload();
    upload.status = { type: "valid", idCount: 1 };
    await failRemoteSavedGroupUploadValidation(context, upload.id);
    expect(upload.status).toEqual({ type: "valid", idCount: 1 });
  });

  it("does nothing for a missing upload", async () => {
    const { context, uploads } = makeContext();
    await expect(
      failRemoteSavedGroupUploadValidation(context, "missing"),
    ).resolves.toBeUndefined();
    expect(uploads).toHaveLength(0);
  });
});

describe("upload details and downloads", () => {
  async function invalidUpload() {
    const { context, uploads } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));
    uploads[0].status = { type: "invalid", invalidLineCount: 1, errors: [] };
    return { context, upload: uploads[0] };
  }

  it("shows any upload with its storage info and location", async () => {
    const { context, upload } = await invalidUpload();
    jest.mocked(getFileInfo).mockResolvedValue({
      size: 3,
      contentType: "text/csv",
      lastModified: new Date("2026-10-01T00:00:00Z"),
      etag: "abc",
    });

    const details = await getRemoteSavedGroupUploadDetails(context, "grp_1", 1);

    expect(details.upload.status.type).toBe("invalid");
    expect(details.file).toEqual({
      size: 3,
      contentType: "text/csv",
      lastModified: "2026-10-01T00:00:00.000Z",
      etag: "abc",
    });
    expect(details.storageLocation).toBe(`s3://bucket/${upload.fileKey}`);
  });

  it("shows a missing file as null", async () => {
    const { context } = await invalidUpload();
    jest.mocked(getFileInfo).mockResolvedValue(null);
    const details = await getRemoteSavedGroupUploadDetails(context, "grp_1", 1);
    expect(details.file).toBeNull();
  });

  it("downloads any upload, while loaders only get valid ones", async () => {
    const { context, upload } = await invalidUpload();
    jest.mocked(getSignedDownloadUrl).mockResolvedValue("https://signed");

    expect(
      await getRemoteSavedGroupUploadDownloadUrl(context, "grp_1", 1),
    ).toBe("https://signed");
    // No name was given, so it falls back to the group and version
    expect(getSignedDownloadUrl).toHaveBeenCalledWith(
      upload.fileKey,
      "grp_1-v1.csv",
      15,
    );
    await expect(
      getRemoteSavedGroupUpload(context, "grp_1", 1),
    ).rejects.toThrow("Could not find that upload");
  });

  it("keeps the original file name for downloads", async () => {
    const { context, uploads } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    const created = await createRemoteSavedGroupUpload(
      context,
      "grp_1",
      stagingKey("a"),
      "VIP accounts.csv",
    );
    expect(created.fileName).toBe("VIP accounts.csv");

    await getRemoteSavedGroupUploadDownloadUrl(context, "grp_1", 1);
    expect(getSignedDownloadUrl).toHaveBeenCalledWith(
      uploads[0].fileKey,
      "VIP accounts.csv",
      15,
    );
  });

  it("is a 404 for a version that doesn't exist", async () => {
    const { context } = makeContext();
    await expect(
      getRemoteSavedGroupUploadDetails(context, "grp_1", 9),
    ).rejects.toThrow("Could not find that upload");
  });
});

describe("deleteRemoteSavedGroupUpload", () => {
  // Versions 1 and up, with the given statuses
  async function uploadsWith(
    statuses: SavedGroupUploadInterface["status"][],
    options?: Parameters<typeof makeContext>[0],
  ) {
    const { context, uploads, audits } = makeContext(options);
    for (const [i, status] of statuses.entries()) {
      files.set(stagingKey(`${i}`), Buffer.from("u1\n"));
      await createRemoteSavedGroupUpload(context, "grp_1", stagingKey(`${i}`));
      uploads[i].status = status;
    }
    return { context, uploads, audits };
  }
  const valid = { type: "valid" as const, idCount: 1 };
  const invalid = { type: "invalid" as const, invalidLineCount: 1, errors: [] };

  it("marks an upload the group doesn't use deleted, deletes its file, and audits it", async () => {
    const { context, uploads, audits } = await uploadsWith([valid, valid], {
      currentUploadVersion: 2,
    });
    const { fileKey } = uploads[0];

    await deleteRemoteSavedGroupUpload(context, "grp_1", 1);

    expect(uploads[0].dateDeleted).toBeInstanceOf(Date);
    expect(files.has(fileKey)).toBe(false);
    expect([...audits.values()]).toContainEqual(
      expect.objectContaining({ event: "savedGroup.uploadDeleted" }),
    );
    const { uploads: listed } = await listRemoteSavedGroupUploads(
      context,
      "grp_1",
      { limit: 10, offset: 0 },
    );
    expect(listed.map((u) => u.version)).toEqual([2]);
    await expect(
      getRemoteSavedGroupUploadDetails(context, "grp_1", 1),
    ).rejects.toThrow("Could not find that upload");
  });

  it("doesn't reuse a deleted version number", async () => {
    const { context, uploads } = await uploadsWith([valid, valid], {
      currentUploadVersion: 1,
    });
    await deleteRemoteSavedGroupUpload(context, "grp_1", 2);

    files.set(stagingKey("next"), Buffer.from("u2\n"));
    const next = await createRemoteSavedGroupUpload(
      context,
      "grp_1",
      stagingKey("next"),
    );

    expect(next.version).toBe(3);
    expect(uploads).toHaveLength(3);
  });

  it("refuses to resubmit a deleted upload's file", async () => {
    const { context } = await uploadsWith([valid, valid], {
      currentUploadVersion: 2,
    });
    await deleteRemoteSavedGroupUpload(context, "grp_1", 1);
    await expect(
      createRemoteSavedGroupUpload(context, "grp_1", stagingKey("0")),
    ).rejects.toThrow("This upload was deleted.");
  });

  it("finishes on retry when the audit failed", async () => {
    const { context, uploads, audits } = await uploadsWith([valid, valid], {
      currentUploadVersion: 2,
    });
    const { fileKey } = uploads[0];
    jest
      .mocked(context.auditLog)
      .mockRejectedValueOnce(new Error("audit down"));

    await expect(
      deleteRemoteSavedGroupUpload(context, "grp_1", 1),
    ).rejects.toThrow("audit down");
    expect(files.has(fileKey)).toBe(true);
    await deleteRemoteSavedGroupUpload(context, "grp_1", 1);

    expect(files.has(fileKey)).toBe(false);
    expect(
      [...audits.values()].filter((a) =>
        JSON.stringify(a).includes("savedGroup.uploadDeleted"),
      ),
    ).toHaveLength(1);
  });

  it("deletes invalid and pending uploads", async () => {
    const { context, uploads } = await uploadsWith([
      invalid,
      { type: "pending" },
    ]);
    await deleteRemoteSavedGroupUpload(context, "grp_1", 1);
    await deleteRemoteSavedGroupUpload(context, "grp_1", 2);
    expect(uploads.every((u) => u.dateDeleted)).toBe(true);
  });

  it("refuses the group's current version", async () => {
    const { context, uploads } = await uploadsWith([valid, valid], {
      currentUploadVersion: 1,
    });
    await expect(
      deleteRemoteSavedGroupUpload(context, "grp_1", 1),
    ).rejects.toThrow("current version");
    expect(uploads).toHaveLength(2);
  });

  it("refuses a version an open draft uses", async () => {
    const { context, uploads } = await uploadsWith([valid, valid], {
      currentUploadVersion: 1,
      draftVersions: [2],
    });
    await expect(
      deleteRemoteSavedGroupUpload(context, "grp_1", 2),
    ).rejects.toThrow("open draft");
    expect(uploads).toHaveLength(2);
  });

  it("needs publish access", async () => {
    const { context } = await uploadsWith([valid, valid]);
    context.permissions.canRevisionAction = () => false;
    await expect(
      deleteRemoteSavedGroupUpload(context, "grp_1", 1),
    ).rejects.toThrow("forbidden");
  });
});

describe("assertUsableUploadVersion", () => {
  it("accepts only a valid upload of the group", async () => {
    const { context, uploads } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));

    // Still pending
    await expect(
      assertUsableUploadVersion(context, "grp_1", 1),
    ).rejects.toThrow("Version 1 is not a valid upload");
    uploads[0].status = { type: "valid", idCount: 1 };
    await expect(
      assertUsableUploadVersion(context, "grp_1", 1),
    ).resolves.toBeUndefined();
    await expect(
      assertUsableUploadVersion(context, "grp_1", 2),
    ).rejects.toThrow("Version 2 is not a valid upload");
  });

  it("needs an Enterprise plan", async () => {
    const { context, uploads } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));
    uploads[0].status = { type: "valid", idCount: 1 };

    context.hasPremiumFeature = () => false;
    await expect(
      assertUsableUploadVersion(context, "grp_1", 1),
    ).rejects.toThrow("require an Enterprise plan");
  });
});

describe("collectRemoteSavedGroupGate", () => {
  const flagOff = () => {
    mockAssertRemoteSavedGroupsEnabled.mockImplementation(() => {
      throw new BadRequestError("Remote Saved Groups are not enabled");
    });
  };
  afterEach(() => {
    mockAssertRemoteSavedGroupsEnabled.mockReset();
  });

  it("passes a valid change, and ignores other group types", async () => {
    const { context, uploads } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));
    uploads[0].status = { type: "valid", idCount: 1 };

    await expect(
      collectRemoteSavedGroupGate(
        context,
        { ...group, currentUploadVersion: 1 },
        group,
      ),
    ).resolves.toEqual([]);

    flagOff();
    const list: SavedGroupInterface = { ...group, type: "list", values: [] };
    await expect(
      collectRemoteSavedGroupGate(context, { ...list, groupName: "x" }, list),
    ).resolves.toEqual([]);
  });

  it("blocks when the flag is off or the plan has lapsed", async () => {
    const { context } = makeContext();
    const renamed = { ...group, groupName: "Renamed" };

    flagOff();
    const [flagGate] = await collectRemoteSavedGroupGate(
      context,
      renamed,
      group,
    );
    expect(flagGate).toMatchObject({
      type: "remote-saved-group",
      severity: "blocker",
      messages: ["Remote Saved Groups are not enabled"],
    });

    mockAssertRemoteSavedGroupsEnabled.mockReset();
    context.hasPremiumFeature = () => false;
    const [planGate] = await collectRemoteSavedGroupGate(
      context,
      renamed,
      group,
    );
    expect(planGate.messages[0]).toContain("require an Enterprise plan");
  });

  it("still allows archiving when the flag is off", async () => {
    const { context } = makeContext();
    flagOff();
    await expect(
      collectRemoteSavedGroupGate(context, { ...group, archived: true }, group),
    ).resolves.toEqual([]);
  });

  it("blocks an upload version that isn't valid", async () => {
    const { context } = makeContext();
    const [gate] = await collectRemoteSavedGroupGate(
      context,
      { ...group, currentUploadVersion: 3 },
      group,
    );
    expect(gate.messages).toEqual([
      "Version 3 is not a valid upload of this Saved Group",
    ]);
  });
});

describe("toApiSavedGroupsWithUploads", () => {
  it("adds the current upload to remote groups only", async () => {
    const { context } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));
    const withApi = {
      ...context,
      models: {
        ...context.models,
        savedGroups: {
          ...context.models.savedGroups,
          toApiInterface: (g: SavedGroupInterface) => ({
            id: g.id,
            type: g.type,
            name: g.groupName,
            dateCreated: g.dateCreated.toISOString(),
            dateUpdated: g.dateUpdated.toISOString(),
          }),
        },
      },
    };

    const [current, none, list] = await toApiSavedGroupsWithUploads(withApi, [
      { ...group, currentUploadVersion: 1 },
      group,
      { ...group, id: "grp_list", type: "list" },
    ]);

    // user_id is a string attribute
    expect(current.currentUpload).toEqual({
      version: 1,
      dateCreated: expect.any(String),
      numeric: false,
    });
    expect(none.currentUpload).toBeNull();
    expect(list).not.toHaveProperty("currentUpload");

    // A version keeps its number mode when the attribute's type changes
    context.org.settings = {
      attributeSchema: [{ property: "user_id", datatype: "number" }],
    };
    const [after] = await toApiSavedGroupsWithUploads(withApi, [
      { ...group, currentUploadVersion: 1 },
    ]);
    expect(after.currentUpload).toMatchObject({ numeric: false });
  });
});

describe("deleteRemoteSavedGroupUploads", () => {
  it("deletes every upload and its file, in batches", async () => {
    const { context, uploads } = makeContext();
    for (let i = 0; i < 250; i++) {
      files.set(stagingKey(`f${i}`), Buffer.from("u1\n"));
      await createRemoteSavedGroupUpload(context, "grp_1", stagingKey(`f${i}`));
    }
    expect(files.size).toBe(250);

    await deleteRemoteSavedGroupUploads(context, "grp_1");

    expect(uploads).toHaveLength(0);
    expect(files.size).toBe(0);
  });
});
