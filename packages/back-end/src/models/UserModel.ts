import mongoose from "mongoose";
import { UserInterface } from "../../types/user";

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
  minTokenDate: Date,
});

export type UserDocument = mongoose.Document & UserInterface;

export const UserModel = mongoose.model<UserInterface>("User", userSchema);

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
  const users: UserDocument[] = await UserModel.find();
  return users.map((u) => u.toJSON<UserDocument>());
}

export async function findUserById(id: string): Promise<UserInterface | null> {
  const user = await UserModel.findOne({ id });
  return user ? user.toJSON<UserDocument>() : null;
}

export async function findUsersByIds(ids: string[]): Promise<UserInterface[]> {
  const users: UserDocument[] = await UserModel.find({
    id: { $in: ids },
  });
  return users.map((u) => u.toJSON<UserDocument>());
}

export async function updateUserById(
  id: string,
  updates: Partial<UserInterface>
): Promise<UserInterface | null> {
  const user = await UserModel.findOne({ id });
  if (!user) throw new Error("Could not find user");
  await user.update({
    ...updates,
  });
  return await UserModel.findOne({ id });
}

export async function deleteUser(id: string): Promise<void> {
  await UserModel.deleteOne({ id });
}

export async function findVerifiedEmails(
  emails: string[] | undefined
): Promise<string[]> {
  let users: UserDocument[] = [];
  if (emails) {
    users = await UserModel.find({
      email: { $in: emails },
      verified: true,
    });
  } else {
    users = await UserModel.find({
      verified: true,
    });
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
