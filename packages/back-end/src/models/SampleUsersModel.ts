import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import { SampleUsersInterface } from "../../types/sample-users";

const sampleUsersSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: {
    type: String,
    index: true,
  },
  name: String,
  description: String,
  owner: String,
  isPublic: Boolean,
  dateCreated: Date,
  dateUpdated: Date,
  attributes: {},
});

type SampleUsersDocument = mongoose.Document & SampleUsersInterface;

const SampleUsersModel = mongoose.model<SampleUsersInterface>(
  "sampleUsers",
  sampleUsersSchema
);

type CreateSampleUsersProps = Omit<
  SampleUsersInterface,
  "dateCreated" | "dateUpdated" | "id"
>;

type UpdateSampleUsersProps = Omit<
  SampleUsersInterface,
  "dateCreated" | "dateUpdated" | "id" | "organization" | "attributeKey"
>;

const toInterface = (doc: SampleUsersDocument): SampleUsersInterface =>
  omit(
    doc.toJSON<SampleUsersDocument>({ flattenMaps: true }),
    ["__v", "_id"]
  );

export function parseSampleUsersString(list: string) {
  const values = list
    .split(",")
    .map((value) => value.trim())
    .filter((value) => !!value);

  return [...new Set(values)];
}

export async function createSampleUser(
  user: CreateSampleUsersProps
): Promise<SampleUsersInterface> {
  const newUser = await SampleUsersModel.create({
    ...user,
    id: uniqid("sam_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  return toInterface(newUser);
}

export async function getAllSampleUsers(
  organization: string,
  owner: string
): Promise<SampleUsersInterface[]> {
  const sampleUsers: SampleUsersDocument[] = await SampleUsersModel.find({
    organization,
  });
  return (
    sampleUsers
      .filter((su) => su.owner === owner || su.isPublic)
      .map((value) => value.toJSON()) || []
  );
}

export async function getSampleUserById(
  sampleUserId: string,
  organization: string
): Promise<SampleUsersInterface | null> {
  const sampleUser = await SampleUsersModel.findOne({
    id: sampleUserId,
    organization: organization,
  });

  return sampleUser ? toInterface(sampleUser) : null;
}

export async function updateSampleUserById(
  sampleUserId: string,
  organization: string,
  user: UpdateSampleUsersProps
): Promise<UpdateSampleUsersProps> {
  const changes = {
    ...user,
    dateUpdated: new Date(),
  };

  await SampleUsersModel.updateOne(
    {
      id: sampleUserId,
      organization: organization,
    },
    changes
  );

  return changes;
}

export async function deleteSampleUserById(id: string, organization: string) {
  await SampleUsersModel.deleteOne({
    id,
    organization,
  });
}
//
// export function toSampleUsersApiInterface(
//   savedGroup: SampleUsersInterface
// ): ApiSampleUsers {
//   return {
//     id: savedGroup.id,
//     att: savedGroup.values,
//     name: savedGroup.groupName,
//     attributeKey: savedGroup.attributeKey,
//     dateCreated: savedGroup.dateCreated.toISOString(),
//     dateUpdated: savedGroup.dateUpdated.toISOString(),
//     owner: savedGroup.owner || "",
//   };
// }
