import mongoose from "mongoose";
import { UserInterface } from "../../types/user";

const userSchema = new mongoose.Schema({
  id: String,
  name: String,
  email: String,
  passwordHash: String,
  admin: Boolean,
});

export type UserDocument = mongoose.Document & UserInterface;

export const UserModel = mongoose.model<UserDocument>("User", userSchema);
