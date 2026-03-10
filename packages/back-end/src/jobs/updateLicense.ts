/**
 * For self-hosted installations this job will update their license data once a day.
 * This will allow us to make sure that any installation that hasn't contacted us within
 * a day may have had their connection to us blocked, and their license would then be
 * void within a week if something is not done to unblock the connection.
 */
import Agenda from "agenda";
import { getSelfHostedOrganization } from "back-end/src/models/OrganizationModel";
import { IS_CLOUD } from "back-end/src/util/secrets";
import {
  getLicenseMetaData,
  getUserCodesForOrg,
} from "back-end/src/services/licenseData";
import { licenseInit } from "back-end/src/enterprise";

const UPDATE_LICENSES_JOB_NAME = "updateLicenses";

const updateLicense = async () => {
  if (IS_CLOUD) {
    return;
  }

  const org = await getSelfHostedOrganization();
  if (org) {
    licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
  }
};

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;
  agenda.define(UPDATE_LICENSES_JOB_NAME, updateLicense);
}

export async function queueUpdateLicense() {
  const job = agenda.create(UPDATE_LICENSES_JOB_NAME, {});
  job.unique({});
  job.repeatEvery("24 hours");
  await job.save();
}
