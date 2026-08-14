import path from "path";
import nodemailer from "nodemailer";
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
  APP_LOCALE,
} from "back-end/src/util/secrets";
import { getEmailFromUserId } from "back-end/src/models/UserModel";
import { getInviteUrl } from "./organizations";

export function isEmailEnabled(): boolean {
  return !!(EMAIL_ENABLED && EMAIL_HOST && EMAIL_PORT && EMAIL_FROM);
}

const noHyperlink = (str: string) => str.replace(/[^a-zA-Z0-9\s]/g, "");

const env = nunjucks.configure(
  path.join(__dirname, "..", "templates", "email"),
  {
    autoescape: true,
  },
);

env.addFilter("noHyperlink", noHyperlink);

function emailTemplate(name: string): string {
  return APP_LOCALE === "ru" ? `ru/${name}` : name;
}

function renderEmail(name: string, ctx: Record<string, unknown>): string {
  return nunjucks.render(emailTemplate(name), {
    ...ctx,
    htmlLang: APP_LOCALE,
  });
}

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

  const headers: { [key: string]: string } = {
    // Required by Google for bulk senders; mailto fallback satisfies the
    // header requirement even for transactional emails that have no real
    // unsubscribe flow.
    "List-Unsubscribe": `<mailto:${EMAIL_FROM}?subject=Unsubscribe>`,
  };

  // If using SendGrid, bypass bounce suppression so transactional emails
  // (invites, password resets) reach users whose address previously soft-bounced.
  // We use bypass_bounce_management instead of bypass_list_management because
  // bypass_list_management circumvents unsubscribe lists, which is a strong
  // spam signal for Gmail and other providers.
  if (ignoreUnsubscribes && EMAIL_HOST === "smtp.sendgrid.net") {
    headers["x-smtpapi"] =
      '{"filters":{"bypass_bounce_management":{"settings":{"enable":1}}}}';
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
  const html = renderEmail("invite.jinja", {
    inviteUrl,
    organizationName: organization.name,
    invitedBy: invite.invitedBy || "",
  });

  await sendMail({
    html,
    subject:
      APP_LOCALE === "ru"
        ? `Вас пригласили в ${noHyperlink(organization.name)} в GrowthBook`
        : `You're invited to join ${noHyperlink(organization.name)} on GrowthBook`,
    to: invite.email,
    text:
      APP_LOCALE === "ru"
        ? `${invite.invitedBy ? `${invite.invitedBy} приглашает вас` : "Вас пригласили"} пользоваться GrowthBook в организации ${noHyperlink(organization.name)}. Принять приглашение: ${inviteUrl}`
        : `${invite.invitedBy ? `${invite.invitedBy} is inviting you to` : "You've been invited to"} use GrowthBook with ${noHyperlink(organization.name)}. Accept your invitation: ${inviteUrl}`,
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
  const html = renderEmail("experiment-changes.jinja", {
    experimentChanges,
    experimentUrl,
    experimentName,
  });
  const subject =
    APP_LOCALE === "ru"
      ? `Изменения в эксперименте: ${noHyperlink(experimentName)}`
      : `Experiment Change for: ${noHyperlink(experimentName)}`;

  await Promise.all(
    userIds.map(async (id) => {
      const email = await getEmailFromUserId(id);
      await sendMail({
        html,
        subject,
        to: email,
        text:
          APP_LOCALE === "ru"
            ? `В эксперименте «${noHyperlink(experimentName)}» изменились метрики:\n- ${experimentChanges.join("\n- ")}\n\nПодробности: ${experimentUrl}`
            : `The experiment '${noHyperlink(
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
  const html = renderEmail("reset-password.jinja", {
    resetUrl,
  });
  await sendMail({
    html,
    subject:
      APP_LOCALE === "ru"
        ? "Сброс пароля GrowthBook"
        : "Reset GrowthBook Password",
    to: email,
    text:
      APP_LOCALE === "ru"
        ? `Сбросить пароль: ${resetUrl}`
        : `Reset your password by visiting ${resetUrl}`,
    ignoreUnsubscribes: true,
  });
}

export async function sendNewOrgEmail(company: string, email: string) {
  if (!SITE_MANAGER_EMAIL) return;

  const html = renderEmail("new-organization.jinja", {
    company,
    email,
  });
  await sendMail({
    html,
    subject:
      APP_LOCALE === "ru"
        ? `Создана новая компания: ${noHyperlink(company)}`
        : `New company created: ${noHyperlink(company)}`,
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
  const html = renderEmail("new-member.jinja", {
    name,
    email,
    organization,
  });

  await sendMail({
    html,
    subject:
      APP_LOCALE === "ru"
        ? `Новый пользователь присоединился к аккаунту GrowthBook: ${noHyperlink(
            name,
          )} (${email})`
        : `A new user joined your GrowthBook account: ${noHyperlink(
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
  const html = renderEmail("pending-member.jinja", {
    name,
    email,
    organization,
    teamUrl,
  });

  await sendMail({
    html,
    subject:
      APP_LOCALE === "ru"
        ? `Пользователь просит присоединиться к аккаунту GrowthBook: ${noHyperlink(
            name,
          )} (${email})`
        : `A new user is requesting to join your GrowthBook account: ${noHyperlink(
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
  const html = renderEmail("pending-member-approval.jinja", {
    name,
    organization,
    mainUrl,
  });

  await sendMail({
    html,
    subject:
      APP_LOCALE === "ru"
        ? `Вас приняли в ${noHyperlink(organization)} в GrowthBook`
        : `You've been approved as a member with ${noHyperlink(
            organization,
          )} on GrowthBook`,
    to: email,
    text:
      APP_LOCALE === "ru"
        ? `Присоединиться к ${noHyperlink(organization)} в GrowthBook`
        : `Join ${noHyperlink(organization)} on GrowthBook`,
  });
}

export async function sendOwnerEmailChangeEmail(
  email: string,
  organization: string,
  originalOwner: string,
  newOwner: string,
) {
  const html = renderEmail("owner-email-change.jinja", {
    email,
    organization,
    originalOwner,
    newOwner,
  });

  await sendMail({
    html,
    subject:
      APP_LOCALE === "ru"
        ? `Владелец ${organization} в GrowthBook изменился`
        : `The owner for ${organization} on GrowthBook has changed`,
    to: originalOwner,
    text: `The owner for ${organization} on GrowthBook has been changed to ${newOwner} by ${email}`,
  });

  await sendMail({
    html,
    subject:
      APP_LOCALE === "ru"
        ? `Владелец ${organization} в GrowthBook изменился`
        : `The owner for ${organization} on GrowthBook has changed`,
    to: newOwner,
    text: `The owner for ${organization} on GrowthBook has been changed to ${newOwner} by ${email}`,
  });
}
