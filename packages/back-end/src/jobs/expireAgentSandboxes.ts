import Agenda from "agenda";
import { findExpiredSandboxOrganizations } from "back-end/src/models/OrganizationModel";
import { expireSandbox } from "back-end/src/services/agentSignup";
import { logger } from "back-end/src/util/logger";

const JOB_NAME = "expireAgentSandboxes";

// The key stops on its own at the deadline; this closes the rest so an
// abandoned sandbox stops serving flags and stops showing up as open.
const expireAgentSandboxes = async () => {
  const orgs = await findExpiredSandboxOrganizations();
  for (const org of orgs) {
    try {
      await expireSandbox(org);
    } catch (e) {
      logger.error({ err: e, orgId: org.id }, "Failed to expire agent sandbox");
    }
  }
  if (orgs.length) logger.info(`Expired ${orgs.length} agent sandbox(es)`);
};

export default async function addExpireAgentSandboxesJob(agenda: Agenda) {
  agenda.define(JOB_NAME, expireAgentSandboxes);

  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery("1 day");
  await job.save();
}
