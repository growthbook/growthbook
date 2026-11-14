import crypto from "crypto";
import mongoose from "mongoose";
import {
  FLAG_IMPORT_CLAIMED_LIFETIME_DAYS,
  FLAG_IMPORT_LIFETIME_HOURS,
  FlagImportResult,
  FlagImportStatus,
} from "shared/validators";

export type FlagImportInterface = {
  id: string;
  tokenHash: string;
  // Null once imported.
  file: string | null;
  name: string | null;
  agent: string | null;
  status: FlagImportStatus;
  dateCreated: Date;
  expiresAt: Date;
  claimed: {
    at: Date;
    userId: string | null;
    organization: string;
  } | null;
  // Set while an import runs, so a second one can't start beside it.
  importingSince: Date | null;
  imported: {
    at: Date;
    userId: string | null;
    autoRunId: string | null;
    results: FlagImportResult[];
  } | null;
};

// Raw Mongoose (not BaseModel): an upload belongs to no organization until it
// is claimed. Uploads take no API key, so a TTL index bounds growth.
const flagImportSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  tokenHash: { type: String, unique: true, required: true },
  // A JSON string: conditions use `$` keys, which can't be stored as fields.
  file: String,
  name: String,
  agent: String,
  status: { type: String, required: true, index: true },
  dateCreated: Date,
  expiresAt: Date,
  claimed: {},
  importingSince: Date,
  imported: {},
});
flagImportSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const FlagImportModel = mongoose.model<FlagImportInterface>(
  "FlagImport",
  flagImportSchema,
);

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function toInterface(doc: FlagImportInterface): FlagImportInterface {
  return {
    id: doc.id,
    tokenHash: doc.tokenHash,
    file: doc.file ?? null,
    name: doc.name ?? null,
    agent: doc.agent ?? null,
    status: doc.status,
    dateCreated: doc.dateCreated,
    expiresAt: doc.expiresAt,
    claimed: doc.claimed ?? null,
    importingSince: doc.importingSince ?? null,
    imported: doc.imported ?? null,
  };
}

export async function createFlagImport(
  props: Pick<FlagImportInterface, "file" | "name" | "agent">,
): Promise<{ token: string; flagImport: FlagImportInterface }> {
  // Only the hash is stored, so the database alone cannot claim an upload.
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const flagImport: FlagImportInterface = {
    ...props,
    id: `fimp_${crypto.randomBytes(12).toString("hex")}`,
    tokenHash: hashToken(token),
    status: "pending",
    dateCreated: now,
    expiresAt: new Date(
      now.getTime() + FLAG_IMPORT_LIFETIME_HOURS * 60 * 60 * 1000,
    ),
    claimed: null,
    importingSince: null,
    imported: null,
  };
  await FlagImportModel.create(flagImport);
  return { token, flagImport };
}

export async function findFlagImportByToken(
  token: string,
): Promise<FlagImportInterface | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  // The TTL monitor runs about once a minute, so check the deadline too.
  const doc = await FlagImportModel.findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
  }).lean();
  return doc ? toInterface(doc) : null;
}

export async function countPendingFlagImports(): Promise<number> {
  return FlagImportModel.countDocuments({ status: "pending" });
}

// Uploads a workspace has claimed and not yet imported.
export async function countClaimedFlagImports(
  organization: string,
): Promise<number> {
  return FlagImportModel.countDocuments({
    status: "claimed",
    "claimed.organization": organization,
    expiresAt: { $gt: new Date() },
  });
}

// One guarded update, so two workspaces opening the same link cannot both
// take it. Claiming gives the workspace longer to import. Resolves to the
// claimed upload, or null when another request got there first.
export async function claimFlagImport(
  id: string,
  by: { userId: string | null; organization: string },
): Promise<FlagImportInterface | null> {
  const now = new Date();
  const doc = await FlagImportModel.findOneAndUpdate(
    { id, status: "pending", expiresAt: { $gt: now } },
    {
      $set: {
        status: "claimed",
        claimed: { at: now, ...by },
        expiresAt: new Date(
          now.getTime() +
            FLAG_IMPORT_CLAIMED_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
        ),
      },
    },
    { new: true },
  ).lean();
  return doc ? toInterface(doc) : null;
}

// An import still running after this long is taken to have died with its
// server, and the upload can be imported again.
const IMPORT_TIMEOUT_MS = 15 * 60 * 1000;

export function isFlagImportRunning(doc: FlagImportInterface): boolean {
  return (
    !!doc.importingSince &&
    doc.importingSince.getTime() > Date.now() - IMPORT_TIMEOUT_MS
  );
}

// One guarded update, so pressing Import twice cannot create things twice. The
// upload stays claimed until the import finishes, so nobody reads it as
// imported before its results exist. Resolves to the upload, file included, or
// null when another import holds it.
export async function beginFlagImport(
  id: string,
  by: { organization: string },
): Promise<FlagImportInterface | null> {
  const now = new Date();
  const doc = await FlagImportModel.findOneAndUpdate(
    {
      id,
      status: "claimed",
      "claimed.organization": by.organization,
      expiresAt: { $gt: now },
      $or: [
        { importingSince: null },
        {
          importingSince: { $lt: new Date(now.getTime() - IMPORT_TIMEOUT_MS) },
        },
      ],
    },
    { $set: { importingSince: now } },
    { new: true },
  ).lean();
  return doc ? toInterface(doc) : null;
}

// Marks the upload imported together with its results. Null when this import
// no longer holds it: it ran past the timeout and another took over.
export async function finishFlagImport(
  id: string,
  startedAt: Date,
  outcome: {
    userId: string | null;
    results: FlagImportResult[];
    autoRunId: string | null;
  },
): Promise<FlagImportInterface | null> {
  const doc = await FlagImportModel.findOneAndUpdate(
    { id, status: "claimed", importingSince: startedAt },
    {
      $set: {
        status: "imported",
        imported: { at: new Date(), ...outcome },
        file: null,
        importingSince: null,
      },
    },
    { new: true },
  ).lean();
  return doc ? toInterface(doc) : null;
}
