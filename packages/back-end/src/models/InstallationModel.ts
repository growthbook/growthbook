/***
 * This file is used to store the installation ID of the app.
 * Each installation (dev, prod, etc.) has a unique ID.
 * This is used as a singleton to identify the installation when registering licenses.
 * The installation name is a user-settable friendly name for the installation
 * for multi-org installations where we can't use the org name.
 */
import { randomUUID } from "crypto";
import mongoose from "mongoose";
import { InstallationInterface } from "back-end/types/installation";

const InstallationSchema = new mongoose.Schema({
  id: String,
  name: String,
});

export type InstallationDocument = mongoose.Document & InstallationInterface;

export const InstallationModel = mongoose.model<InstallationInterface>(
  "Installation",
  InstallationSchema,
);

function toInterface(doc: InstallationDocument): InstallationInterface {
  return doc.toJSON();
}

export async function getInstallation(): Promise<InstallationInterface> {
  const installation = await InstallationModel.findOne({});
  if (installation) {
    return toInterface(installation);
  } else {
    const installationId = `installation-${randomUUID()}`;
    return toInterface(await InstallationModel.create({ id: installationId }));
  }
}

export async function setInstallationName(name: string): Promise<void> {
  const installation = await InstallationModel.findOne({});
  if (installation) {
    installation.name = name;
    await installation.save();
  } else {
    const installationId = `installation-${randomUUID()}`;
    await InstallationModel.create({ id: installationId, name });
  }
}
