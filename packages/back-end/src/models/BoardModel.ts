import mongoose from "mongoose";
import { BoardInterface } from "../../types/board";

const boardSchema = new mongoose.Schema({
  organization: {
    type: String,
    unique: true,
  },
  columns: [
    {
      _id: false,
      type: {
        type: String,
      },
      display: String,
      experiments: [String],
    },
  ],
});

export type BoardDocument = mongoose.Document & BoardInterface;

export const BoardModel = mongoose.model<BoardDocument>("Board", boardSchema);
