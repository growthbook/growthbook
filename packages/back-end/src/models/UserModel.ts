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
  admin: Boolean,
  verified: Boolean,
});

export type UserDocument = mongoose.Document & UserInterface;

export const UserModel = mongoose.model<UserDocument>("User", userSchema);

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
  const users = await UserModel.find();
  return users.map((u) => u.toJSON());
}

export async function findUserById(id: string): Promise<UserInterface | null> {
  const user = await UserModel.findOne({ id });
  return user ? user.toJSON() : null;
}

export async function deleteUser(id: string): Promise<void> {
  await UserModel.deleteOne({ id });
}

export async function findVerifiedEmails(
  emails: string[] | undefined
): Promise<string[]> {
  let users;
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
