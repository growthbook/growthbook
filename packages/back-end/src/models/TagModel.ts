import mongoose from "mongoose";
import { TagDBInterface, TagInterface } from "../../types/tag";

const tagSchema = new mongoose.Schema({
  organization: {
    type: String,
    index: true,
  },
  tags: [String],
  settings: {
    type: Map,
    of: {
      _id: false,
      name: String,
      color: String,
      description: String,
    },
  },
});

export type TagDocument = mongoose.Document & TagDBInterface;

export const TagModel = mongoose.model<TagDocument>("Tag", tagSchema);

export function toTagInterface(doc: TagDocument): TagInterface[] {
  const tagDB = doc.toJSON();
  return tagDB.tags.map((t) => {
    return {
      name: t,
      color: tagDB?.settings?.[t]?.color ?? "",
      description: tagDB?.settings?.[t]?.description ?? "",
    };
  });
}
