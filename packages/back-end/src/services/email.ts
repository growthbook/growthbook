import path from "path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

const _dir = path.dirname(fileURLToPath(import.meta.url));
import nunjucks from "nunjucks";
import { OrganizationInterface } from "shared/types/organization";
import {
  EMAIL_ENABLED,
  EMAIL_FROM,
  EMAIL_HOST,
  EMAIL_HOST_PASSWORD,
  EMAIL_HOST_USER,
  EMAIL_PORT,
  SITE_MANAGER_EMAIL,
  APP_ORIGIN,
} from "back-end/src/util/secrets";
import { getEmailFromUserId } from "back-end/src/models/UserModel";
import { getInviteUrl } from "./organizations.js";

export function isEmailEnabled(): boolean {
  return !!(EMAIL_ENABLED && EMAIL_HOST && EMAIL_PORT && EMAIL_FROM);
}

const noHyperlink = (str: string) => str.replace(/[^a-zA-Z0-9\s]/g, "");

const env = nunjucks.configure(path.join(_dir, "..", "templates", "email"), {
  autoescape: true,
});

env.addFilter("noHyperlink", noHyperlink);

const transporter = isEmailEnabled()
  ? nodemailer.createTransport({
      host: EMAIL_HOST,
      port: EMAIL_PORT,
      secure: EMAIL_PORT === 465,
      ...(EMAIL_HOST_USER &&
        EMAIL_HOST_PASSWORD && {
          auth: {
            user: EMAIL_HOST_USER,
            pass: EMAIL_HOST_PASSWORD,
          },
        }),
    })
  : null;

async function sendMail({
  html,
  subject,
  to,
  text,
  ignoreUnsubscribes = false,
}: {
  html: string;
  subject: string;
  to: string;
  text: string;
  ignoreUnsubscribes?: boolean;
}) {
  if (!isEmailEnabled() || !transporter) {
    throw new Error("Email server not configured.");
  }
  if (typeof to !== "string") {
    throw new Error("Email address must be a string");
  }

  const headers: { [key: string]: string } = {};

  // If using Sendgrid, we can bypass unsubscribe lists for important emails
  if (ignoreUnsubscribes && EMAIL_HOST === "smtp.sendgrid.net") {
    headers["x-smtpapi"] =
      '{"filters":{"bypass_list_management":{"settings":{"enable":1}}}}';
  }

  await transporter.sendMail({
    from: `"GrowthBook" <${EMAIL_FROM}>`,
    to,
    subject,
    text,
    html,
    headers,
  });
}

export async function sendInviteEmail(
  organization: OrganizationInterface,
  key: string,
) {
  const invite = organization.invites.filter((invite) => invite.key === key)[0];
  if (!invite) {
    throw new Error("Could not find invite with specified key");
  }

  const inviteUrl = getInviteUrl(key);
  const html = nunjucks.render("invite.jinja", {
    inviteUrl,
    organizationName: organization.name,
  });

  await sendMail({
    html,
    subject: `You've been invited to join ${noHyperlink(
      organization.name,
    )} on GrowthBook`,
    to: invite.email,
    text: `Join ${organization.name} on GrowthBook by visiting ${inviteUrl}`,
    ignoreUnsubscribes: true,
  });
}

export async function sendExperimentChangesEmail(
  userIds: string[],
  experimentId: string,
  experimentName: string,
  experimentChanges: string[],
) {
  const experimentUrl =
    APP_ORIGIN +
    (APP_ORIGIN.endsWith("/") ? "" : "/") +
    "experiment/" +
    experimentId +
    "#results";
  const html = nunjucks.render("experiment-changes.jinja", {
    experimentChanges,
    experimentUrl,
    experimentName,
  });
  const subject = `Experiment Change for: ${noHyperlink(experimentName)}`;

  await Promise.all(
    userIds.map(async (id) => {
      const email = await getEmailFromUserId(id);
      await sendMail({
        html,
        subject,
        to: email,
        text:
          `The experiment '${noHyperlink(
            experimentName,
          )}' has the following metric changes:` +
          "- " +
          experimentChanges.join("\n- ") +
          `\n\nSee more details at ${experimentUrl}`,
      });
    }),
  );
}

export async function sendResetPasswordEmail(email: string, resetUrl: string) {
  const html = nunjucks.render("reset-password.jinja", {
    resetUrl,
  });
  await sendMail({
    html,
    subject: "Reset GrowthBook Password",
    to: email,
    text: `Reset your password by visiting ${resetUrl}`,
    ignoreUnsubscribes: true,
  });
}

export async function sendNewOrgEmail(company: string, email: string) {
  if (!SITE_MANAGER_EMAIL) return;

  const html = nunjucks.render("new-organization.jinja", {
    company,
    email,
  });
  await sendMail({
    html,
    subject: `New company created: ${noHyperlink(company)}`,
    to: SITE_MANAGER_EMAIL,
    text: `Company Name: ${noHyperlink(company)}\nOwner Email: ${email}`,
  });
}

export async function sendNewMemberEmail(
  name: string,
  email: string,
  organization: string,
  ownerEmail: string,
) {
  const html = nunjucks.render("new-member.jinja", {
    name,
    email,
    organization,
  });

  await sendMail({
    html,
    subject: `A new user joined your GrowthBook account: ${noHyperlink(
      name,
    )} (${email})`,
    to: ownerEmail,
    text: `Organization: ${noHyperlink(organization)}\nName: ${noHyperlink(
      name,
    )}\nEmail: ${email}`,
  });
}

export async function sendPendingMemberEmail(
  name: string,
  email: string,
  organization: string,
  ownerEmail: string,
  teamUrl: string,
) {
  const html = nunjucks.render("pending-member.jinja", {
    name,
    email,
    organization,
    teamUrl,
  });

  await sendMail({
    html,
    subject: `A new user is requesting to join your GrowthBook account: ${noHyperlink(
      name,
    )} (${email})`,
    to: ownerEmail,
    text: `Organization: ${noHyperlink(organization)}\nName: ${noHyperlink(
      name,
    )}\nEmail: ${email}`,
  });
}

export async function sendPendingMemberApprovalEmail(
  name: string,
  email: string,
  organization: string,
  mainUrl: string,
) {
  const html = nunjucks.render("pending-member-approval.jinja", {
    name,
    organization,
    mainUrl,
  });

  await sendMail({
    html,
    subject: `You've been approved as a member with ${noHyperlink(
      organization,
    )} on GrowthBook`,
    to: email,
    text: `Join ${noHyperlink(organization)} on GrowthBook`,
  });
}

export async function sendOwnerEmailChangeEmail(
  email: string,
  organization: string,
  originalOwner: string,
  newOwner: string,
) {
  const html = nunjucks.render("owner-email-change.jinja", {
    email,
    organization,
    originalOwner,
    newOwner,
  });

  await sendMail({
    html,
    subject: `The owner for ${organization} on GrowthBook has changed`,
    to: originalOwner,
    text: `The owner for ${organization} on GrowthBook has been changed to ${newOwner} by ${email}`,
  });

  await sendMail({
    html,
    subject: `The owner for ${organization} on GrowthBook has changed`,
    to: newOwner,
    text: `The owner for ${organization} on GrowthBook has been changed to ${newOwner} by ${email}`,
  });
}
