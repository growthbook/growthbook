import mongoose from "mongoose";
import uniqid from "uniqid";
import { Document } from "mongodb";
import { UserInterface } from "../../types/user";
import { usingOpenId, validatePasswordFormat } from "../services/auth";
import { hash } from "../services/users";
import {
  ToInterface,
  getCollection,
  removeMongooseFields,
} from "../util/mongo.util";

const userSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  name: String,
  email: {
    type: String,
    unique: true,
  },
  passwordHash: String,
  superAdmin: Boolean,
  verified: Boolean,
  agreedToTerms: Boolean,
  minTokenDate: Date,
  dateCreated: Date,
});

const UserModel = mongoose.model<UserInterface>("User", userSchema);
const COLLECTION = "users";

const toInterface: ToInterface<UserInterface> = (doc) => {
  const obj = removeMongooseFields(doc);
  if (!obj.dateCreated) obj.dateCreated = doc._id?.getTimestamp();
  return obj;
};

export async function markUserAsVerified(id: string) {
  await UserModel.updateOne(
    { id },
    {
      $set: {
        verified: true,
      },
    }
  );
}

export async function getAllUsers(): Promise<UserInterface[]> {
  const users = await getCollection(COLLECTION).find().toArray();
  return users.map((u) => toInterface(u));
}

export async function getUserById(id: string): Promise<UserInterface | null> {
  const user = await getCollection(COLLECTION).findOne({ id });
  return user ? toInterface(user) : null;
}

export async function getUserByEmail(
  email: string
): Promise<UserInterface | null> {
  const user = await getCollection(COLLECTION).findOne({ email });
  return user ? toInterface(user) : null;
}

export async function getUsersByIds(ids: string[]): Promise<UserInterface[]> {
  const docs = await getCollection(COLLECTION)
    .find({
      id: { $in: ids },
    })
    .toArray();
  return docs.map((u) => toInterface(u));
}

export async function deleteUser(id: string): Promise<void> {
  await UserModel.deleteOne({ id });
}

export async function createUser({
  name,
  email,
  password,
  verified = false,
  superAdmin = false,
  agreedToTerms = false,
}: {
  name: string;
  email: string;
  password?: string;
  verified?: boolean;
  superAdmin?: boolean;
  agreedToTerms?: boolean;
}) {
  let passwordHash = "";

  if (!usingOpenId()) {
    password = validatePasswordFormat(password);
    passwordHash = await hash(password);
  }

  return toInterface(
    await UserModel.create({
      name,
      email,
      passwordHash,
      id: uniqid("u_"),
      verified,
      superAdmin,
      dateCreated: new Date(),
      agreedToTerms,
    })
  );
}

export async function findVerifiedEmails(
  emails: string[] | undefined
): Promise<string[]> {
  let users: Document[] = [];
  if (emails) {
    users = await getCollection(COLLECTION)
      .find({
        email: { $in: emails },
        verified: true,
      })
      .toArray();
  } else {
    users = await getCollection(COLLECTION)
      .find({
        verified: true,
      })
      .toArray();
  }
  return users.map((u) => u.email);
}

export async function resetMinTokenDate(userId: string) {
  await UserModel.updateOne(
    {
      id: userId,
    },
    {
      $set: {
        minTokenDate: new Date(),
      },
    }
  );
}

export async function updateUser(
  id: string,
  updates: Partial<Pick<UserInterface, "passwordHash" | "name">>
) {
  await UserModel.updateOne(
    {
      id,
    },
    {
      $set: updates,
    }
  );
}

export async function hasUser() {
  const doc = await getCollection(COLLECTION).findOne();
  return !!doc;
}

export async function getAllUserEmailsAcrossAllOrgs(): Promise<string[]> {
  const users = await UserModel.aggregate([
    {
      $lookup: {
        from: "organizations",
        localField: "id",
        foreignField: "members.id",
        as: "orgs",
      },
    },
    {
      $match: {
        "orgs.0": { $exists: true },
      },
    },
  ]);

  return users.map((u) => u.email);
}

export async function getEmailFromUserId(userId: string) {
  const u = await getCollection(COLLECTION).findOne({ id: userId });
  return u?.email || "";
}
