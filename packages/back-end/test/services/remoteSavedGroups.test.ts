import type { OrganizationInterface } from "shared/types/organization";
import type { SavedGroupInterface } from "shared/types/saved-group";
import type { SavedGroupUploadInterface } from "shared/validators";
import {
  copyFile,
  deleteFile,
  getFileSize,
  readFileRange,
  readFileStream,
} from "back-end/src/services/files";
import { queueValidateRemoteSavedGroupUpload } from "back-end/src/jobs/validateRemoteSavedGroupUpload";
import {
  createRemoteSavedGroupUpload,
  deleteRemoteSavedGroupUploads,
  RemoteSavedGroupsContext,
  validateRemoteSavedGroupUpload,
} from "back-end/src/services/remoteSavedGroups";

jest.mock("back-end/src/services/files", () => ({
  copyFile: jest.fn(),
  deleteFile: jest.fn(),
  getFileSize: jest.fn(),
  getSignedUploadUrl: jest.fn(),
  readFileRange: jest.fn(),
  readFileStream: jest.fn(),
}));
jest.mock("back-end/src/jobs/validateRemoteSavedGroupUpload", () => ({
  queueValidateRemoteSavedGroupUpload: jest.fn(),
}));
jest.mock("back-end/src/services/savedGroups", () => ({
  ...jest.requireActual("back-end/src/services/savedGroups"),
  assertRemoteSavedGroupsEnabled: jest.fn(),
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

const duplicateKeyError = () =>
  Object.assign(new Error("E11000 duplicate key"), { code: 11000 });

// A context with an upload store that enforces the model's unique indexes.
function makeContext() {
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
      savedGroups: { getById: async (id) => (id === group.id ? group : null) },
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
        getLatestValidBySavedGroups: async () => new Map(),
        getPageBySavedGroup: async (savedGroupId, { limit, offset }) => {
          const matching = uploads
            .filter((u) => u.savedGroupId === savedGroupId)
            .sort((a, b) => b.version - a.version);
          return {
            uploads: matching.slice(offset, offset + limit),
            total: matching.length,
          };
        },
        getVersion: async (savedGroupId, version) =>
          uploads.find(
            (u) => u.savedGroupId === savedGroupId && u.version === version,
          ) ?? null,
        setStatus: async (upload, status) => {
          const stored = uploads.find((u) => u.id === upload.id);
          if (stored?.status.type === "pending") stored.status = status;
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

    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));
    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));

    expect(audits.size).toBe(1);
  });

  it("writes the audit event on retry when the first write failed", async () => {
    const { context, audits } = makeContext();
    files.set(stagingKey("a"), Buffer.from("u1\n"));
    jest
      .mocked(context.auditLog)
      .mockRejectedValueOnce(new Error("audit down"));

    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));
    expect(audits.size).toBe(0);
    await createRemoteSavedGroupUpload(context, "grp_1", stagingKey("a"));

    expect(audits.size).toBe(1);
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

  it("deletes only its own copy when the sample check fails", async () => {
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

  it("marks a good file valid", async () => {
    const { context, upload } = await pendingUpload("user_id\nu1\nu2\nu1\n");
    await validateRemoteSavedGroupUpload(context, upload.id);
    expect(upload.status).toEqual({ type: "valid", idCount: 3 });
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

  it("leaves a finished upload alone", async () => {
    const { context, upload } = await pendingUpload("u1\n");
    upload.status = { type: "valid", idCount: 1 };
    await validateRemoteSavedGroupUpload(context, upload.id);
    expect(readFileStream).not.toHaveBeenCalled();
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
