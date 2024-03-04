import mongoose from "mongoose";
import { LicenseInterface } from "../license";

const licenseSchema = new mongoose.Schema({
  id: String, // Unique ID for the license key
  companyName: String, // Name of the organization on the license
  organizationId: String, // OrganizationId (keys prior to 12/2022 do not contain this field)
  seats: Number, // Maximum number of seats on the license
  isTrial: { type: Boolean, default: false }, // True if this is a trial license
  emailVerified: { type: Boolean, default: false }, // True if the email has been verified
  plan: String, // The plan (pro, enterprise, etc.) for this license
  archived: { type: Boolean, default: false }, // True if this license has been deleted/archived
  seatsInUse: { type: Number, default: 0 }, // Number of seats currently in use
  remoteDowngrade: { type: Boolean, default: false }, // True if this license was downgraded remotely
  message: {
    text: String, // The text to show in the account notice
    className: String, // The class name to apply to the account notice
    tooltipText: String, // The text to show in the tooltip
    showAllUsers: Boolean, // True if all users should see the notice rather than just the admins
  },
  stripeSubscription: {
    id: String,
    qty: Number,
    trialEnd: Date,
    status: String,
    current_period_end: Number,
    cancel_at: Number,
    canceled_at: Number,
    cancel_at_period_end: Boolean,
    planNickname: String,
    priceId: String,
    hasPaymentMethod: Boolean,
  },
  price: Number, // The price of the license
  discountAmount: Number, // The amount of the discount
  discountMessage: String, // The message of the discount
  installationUsers: {
    type: Map,
    of: { _id: false, date: Date, userHashes: [String] },
  }, // Map of first 7 chars of user email shas to the last time they were in a usage request
  signedChecksum: String, // Checksum of the license key
  dateCreated: Date, // Date the license was issued
  dateExpires: Date, // Date the license expires
  dateUpdated: Date, // Date the license was last updated
});

export type LicenseDocument = mongoose.Document & LicenseInterface;

const LicenseModel = mongoose.model<LicenseDocument>("License", licenseSchema);

export { LicenseModel };
