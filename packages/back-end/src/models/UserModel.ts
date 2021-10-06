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
  isVerified: Boolean,
  verificationToken: String,
  verificationSent: {
    type: Date,
    // Link is valid for 30 days
    expires: 30 * 60 * 60 * 24,
  },
});

export type UserDocument = mongoose.Document & UserInterface;

export const UserModel = mongoose.model<UserDocument>("User", userSchema);

export async function updateUser(id: string, update: Partial<UserInterface>) {
  await UserModel.updateOne(
    {
      id,
    },
    {
      $set: update,
    }
  );
}
