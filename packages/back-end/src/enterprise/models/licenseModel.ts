import mongoose from "mongoose";
import omit from "lodash/omit";
import { LicenseInterface } from "shared/enterprise";

const licenseSchema = new mongoose.Schema({
  id: String, // Unique ID for the license key
  companyName: String, // Name of the organization on the license
  organizationId: String, // OrganizationId (keys prior to 12/2022 do not contain this field)
  seats: Number, // Maximum number of seats on the license
  hardCap: { type: Boolean, default: false }, // True if this license has a hard cap on the number of seats
  isTrial: { type: Boolean, default: false }, // True if this is a trial license
  emailVerified: { type: Boolean, default: false }, // True if the email has been verified
  plan: String, // The plan (pro, enterprise, etc.) for this license
  archived: { type: Boolean, default: false }, // True if this license has been deleted/archived
  seatsInUse: { type: Number, default: 0 }, // Number of seats currently in use
  fullMemberSeatsInUse: { type: Number }, // Number of member seats currently in use
  readOnlySeatsInUse: { type: Number }, // Number of read only seats currently in use
  inviteSeatsInUse: { type: Number }, // Number of invite seats currently in use
  remoteDowngrade: { type: Boolean, default: false }, // True if this license was downgraded remotely
  message: {
    text: String, // The text to show in the account notice
    className: String, // The class name to apply to the account notice
    tooltipText: String, // The text to show in the tooltip
    showAllUsers: Boolean, // True if all users should see the notice rather than just the admins
  },
  vercelInstallationId: String, // The Vercel installation ID
  orbSubscription: {},
  stripeSubscription: {},
  price: Number, // The price of the license
  discountAmount: Number, // The amount of the discount
  discountMessage: String, // The message of the discount
  installationUsers: {
    type: Map,
    of: {
      _id: false,
      date: Date,
      installationName: String,
      userHashes: [String],
      licenseUserCodes: {
        invites: [String],
        fullMembers: [String],
        readOnlyMembers: [String],
      },
    },
  }, // Map of first 7 chars of user email shas to the last time they were in a usage request
  usingMongoCache: { type: Boolean, default: true }, // True if the license is using the mongo cache
  firstFailedFetchDate: Date, // Date of the first failed fetch
  lastFailedFetchDate: Date, // Date of the last failed fetch
  lastServerErrorMessage: String, // The last error message from a failed fetch
  signedChecksum: String, // Checksum of the license key
  dateCreated: Date, // Date the license was issued
  dateExpires: Date, // Date the license expires
  dateUpdated: Date, // Date the license was last updated
});

export type LicenseDocument = mongoose.Document & LicenseInterface;

const LicenseModel = mongoose.model<LicenseDocument>("License", licenseSchema);

export { LicenseModel };

export function toInterface(doc: LicenseDocument): LicenseInterface {
  const ret = doc.toJSON<LicenseDocument>();
  return omit(ret, ["__v", "_id"]);
}

export async function getLicenseByKey(
  key: string,
): Promise<LicenseInterface | null> {
  const doc = await LicenseModel.findOne({ id: key });
  return doc ? toInterface(doc) : null;
}
