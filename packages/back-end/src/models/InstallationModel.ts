/***
 * This file is used to store the installation ID of the app.
 * Each installation (dev, prod, etc.) has a unique ID.
 * This is used as a singleton to identify the installation when registering licenses.
 */
import { randomUUID } from "crypto";
import mongoose from "mongoose";

const InstallationSchema = new mongoose.Schema({
  id: String,
});

export type InstallationDocument = mongoose.Document & {
  id: string;
};

export const InstallationModel = mongoose.model<InstallationDocument>(
  "Installation",
  InstallationSchema,
);

export async function getInstallationId(): Promise<string> {
  const installation = await InstallationModel.findOne({});
  if (installation) {
    return installation.id;
  } else {
    const installationId = `installation-${randomUUID()}`;
    await InstallationModel.create({ id: installationId });
    return installationId;
  }
}
