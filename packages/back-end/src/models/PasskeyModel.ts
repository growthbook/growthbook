import mongoose from "mongoose";
import uniqid from "uniqid";
import { PasskeyInterface } from "shared/validators";
import {
  ToInterface,
  removeMongooseFields,
} from "back-end/src/util/mongo.util";

// What a successful sign-in tells us about the passkey
export type PasskeyUse = Pick<
  PasskeyInterface,
  "counter" | "backedUp" | "deviceType"
>;

// Passkeys belong to a user, not an organization, and sign-in reads them
// before there is an organization, so this isn't a BaseModel.
const passkeySchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  userId: {
    type: String,
    index: true,
  },
  credentialId: {
    type: String,
    unique: true,
  },
  publicKey: String,
  counter: Number,
  transports: [String],
  deviceType: String,
  backedUp: Boolean,
  name: String,
  dateCreated: Date,
  lastUsed: Date,
});

const PasskeyModel = mongoose.model<PasskeyInterface>("Passkey", passkeySchema);

const toInterface: ToInterface<PasskeyInterface> = (doc) =>
  removeMongooseFields(doc);

export async function createPasskey(
  passkey: Omit<PasskeyInterface, "id" | "dateCreated" | "lastUsed">,
): Promise<PasskeyInterface> {
  const doc = await PasskeyModel.create({
    ...passkey,
    id: uniqid("pk_"),
    dateCreated: new Date(),
    lastUsed: null,
  });
  return toInterface(doc);
}

export async function getPasskeysByUserId(
  userId: string,
): Promise<PasskeyInterface[]> {
  const docs = await PasskeyModel.find({ userId }).sort({ dateCreated: 1 });
  return docs.map(toInterface);
}

export async function getPasskeyByCredentialId(
  credentialId: string,
): Promise<PasskeyInterface | null> {
  const doc = await PasskeyModel.findOne({
    // $eq + String() so a non-string id can never act as a Mongo operator
    credentialId: { $eq: String(credentialId) },
  });
  return doc ? toInterface(doc) : null;
}

export async function renamePasskey(
  userId: string,
  id: string,
  name: string,
): Promise<boolean> {
  const res = await PasskeyModel.updateOne({ userId, id }, { $set: { name } });
  return res.matchedCount === 1;
}

export async function recordPasskeyUse(
  id: string,
  { counter, backedUp, deviceType }: PasskeyUse,
) {
  await PasskeyModel.updateOne(
    { id },
    {
      // $max so a slower sign-in that finishes last can't move it backwards
      $max: { counter },
      // A passkey can start syncing after it was added
      $set: { backedUp, deviceType, lastUsed: new Date() },
    },
  );
}

export async function deletePasskey(
  userId: string,
  id: string,
): Promise<boolean> {
  const res = await PasskeyModel.deleteOne({ userId, id });
  return res.deletedCount === 1;
}

export async function deletePasskeysByUserId(userId: string) {
  await PasskeyModel.deleteMany({ userId });
}
