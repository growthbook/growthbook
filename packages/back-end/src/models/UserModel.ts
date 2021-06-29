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
});

export type UserDocument = mongoose.Document & UserInterface;

export const UserModel = mongoose.model<UserDocument>("User", userSchema);
