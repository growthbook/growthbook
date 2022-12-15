import path from "path";
import nodemailer from "nodemailer";
import nunjucks from "nunjucks";
import {
  EMAIL_ENABLED,
  EMAIL_FROM,
  EMAIL_HOST,
  EMAIL_HOST_PASSWORD,
  EMAIL_HOST_USER,
  EMAIL_PORT,
  SITE_MANAGER_EMAIL,
  APP_ORIGIN,
} from "../util/secrets";
import { OrganizationInterface } from "../../types/organization";
import { getEmailFromUserId, getInviteUrl } from "./organizations";
export function isEmailEnabled(): boolean {
  if (!EMAIL_ENABLED) return false;
  if (!EMAIL_HOST) return false;
  if (!EMAIL_PORT) return false;
  if (!EMAIL_HOST_USER) return false;
  if (!EMAIL_HOST_PASSWORD) return false;
  if (!EMAIL_FROM) return false;

  return true;
}
nunjucks.configure(path.join(__dirname, "..", "templates", "email"), {
  autoescape: true,
});

const transporter = isEmailEnabled()
  ? nodemailer.createTransport({
      host: EMAIL_HOST,
      port: EMAIL_PORT,
      secure: EMAIL_PORT === 465,
      auth: {
        user: EMAIL_HOST_USER,
        pass: EMAIL_HOST_PASSWORD,
      },
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
  key: string
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
    subject: `You've been invited to join ${organization.name} on GrowthBook`,
    to: invite.email,
    text: `Join ${organization.name} on GrowthBook by visiting ${inviteUrl}`,
    ignoreUnsubscribes: true,
  });
}

export async function sendExperimentChangesEmail(
  userIds: string[],
  experimentId: string,
  experimentName: string,
  experimentChanges: string[]
) {
  const experimentUrl = APP_ORIGIN + "experiment/" + experimentId + "#results";
  const html = nunjucks.render("experiment-changes.jinja", {
    experimentChanges,
    experimentUrl,
    experimentName,
  });
  const subject = `Experiment Change for: ${experimentName}`;

  await Promise.all(
    userIds.map(async (id) => {
      const email = await getEmailFromUserId(id);
      await sendMail({
        html,
        subject,
        to: email,
        text:
          `The experiment '${experimentName}' has the following metric changes:` +
          "- " +
          experimentChanges.join("\n- ") +
          `\n\nSee more details at ${experimentUrl}`,
      });
    })
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
    subject: `New company created: ${company}`,
    to: SITE_MANAGER_EMAIL,
    text: `Company Name: ${company}\nOwner Email: ${email}`,
  });
}

export async function sendNewMemberEmail(
  name: string,
  email: string,
  organization: string,
  ownerEmail: string
) {
  const html = nunjucks.render("new-member.jinja", {
    name,
    email,
    organization,
  });

  await sendMail({
    html,
    subject: `A new user joined your GrowthBook account: ${name} (${email})`,
    to: ownerEmail,
    text: `Organization: ${organization}\nName: ${name}\nEmail: ${email}`,
  });
}
