/**
 * For self-hosted installations this job will update their license data once a day.
 * This will allow us to make sure that any installation that hasn't contacted us within
 * a day may have had their connection to us blocked, and their license would then be
 * void within a week if something is not done to unblock the connection.
 *
 * For cloud installations this will ensure that any seats added to the organization
 * from the api or scim will be reflected in the license data and can update their
 * subscription accordingly.
 */
import Agenda from "agenda";
import { licenseInit } from "shared/enterprise";
import {
  findOrganizationsWithLicenseKey,
  getSelfHostedOrganization,
} from "back-end/src/models/OrganizationModel";
import { trackJob } from "back-end/src/services/otel";
import { IS_CLOUD } from "back-end/src/util/secrets";
import {
  getLicenseMetaData,
  getUserCodesForOrg,
} from "back-end/src/services/licenseData";

const UPDATE_LICENSES_JOB_NAME = "updateLicenses";

const updateLicense = trackJob(UPDATE_LICENSES_JOB_NAME, async () => {
  if (IS_CLOUD) {
    const orgs = await findOrganizationsWithLicenseKey();
    // initialize the licenses at a rate of 1 per second to not overwhelm the license server
    for (const org of orgs) {
      licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          process.env.LICENSE_UPDATE_DELAY
            ? parseInt(process.env.LICENSE_UPDATE_DELAY)
            : 1000
        )
      );
    }
  } else {
    const org = await getSelfHostedOrganization();
    if (org) {
      licenseInit(org, getUserCodesForOrg, getLicenseMetaData);
    }
  }
});

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
