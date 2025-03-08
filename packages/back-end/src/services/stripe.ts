import { Stripe } from "stripe";
import { STRIPE_SECRET } from "back-end/src/util/secrets";
import {
  findOrganizationByStripeCustomerId,
  updateOrganizationByStripeId,
} from "back-end/src/models/OrganizationModel";
import { OrganizationInterface } from "back-end/types/organization";
import { logger } from "back-end/src/util/logger";

const BRAND_NAMES: Record<string, string> = {
  amex: "American Express",
  diners: "Diners Club",
  discover: "Discover",
  eftpos_au: "Eftpos Australia",
  jcb: "JCB",
  mastercard: "Mastercard",
  unionpay: "UnionPay",
  visa: "Visa",
  us_bank_account: "US Bank Account",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  link: "Link by Stripe",
  unknown: "Unknown Card Brand",
  acss_debit: "ACSS Debit",
  affirm: "Affirm",
  afterpay_clearpay: "Afterpay Clearpay",
  alipay: "Alipay",
  au_becs_debit: "AU BECS Debit",
  bacs_debit: "BACS Debit",
  bancontact: "Bancontact",
  blik: "BLIK",
  boleto: "Boleto",
  card: "Card",
  card_present: "Card Present",
  cashapp: "Cash App",
  customer_balance: "Customer Balance",
  eps: "EPS",
  fpx: "FPX",
  giropay: "Giropay",
  grabpay: "GrabPay",
  ideal: "iDEAL",
  interac_present: "Interac Present",
  klarna: "Klarna",
  konbini: "Konbini",
  oxxo: "OXXO",
  p24: "P24",
  paynow: "PayNow",
  paypal: "PayPal",
  pix: "Pix",
  promptpay: "PromptPay",
  sepa_debit: "SEPA Debit",
  sofort: "Sofort",
  wechat_pay: "WeChat Pay",
  zip: "Zip",
};

// TODO: Get rid of this file once all license data has moved off all organizations
export const stripe = new Stripe(STRIPE_SECRET || "", {
  apiVersion: "2023-08-16",
});

/**
 * @name updateSubscriptionInDb
 * @description This function updates the subscription in the database. (organization.subscription)
 */
export async function updateSubscriptionInDb(
  subscription: string | Stripe.Subscription
): Promise<{
  organization: OrganizationInterface;
  subscription: Stripe.Subscription;
  hasPaymentMethod: boolean;
} | null> {
  // Always get the latest subscription data from the API
  subscription = await stripe.subscriptions.retrieve(
    typeof subscription === "string" ? subscription : subscription.id,
    { expand: ["plan"] }
  );

  if ("ignore_webhooks" in subscription.metadata) {
    return null;
  }

  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const org = await findOrganizationByStripeCustomerId(stripeCustomerId);
  if (!org) {
    throw new Error("Organization not found");
  }

  // update the payment method via API call (webhook body doesn't always include the payment method)
  let hasPaymentMethod = false;
  await stripe.paymentMethods
    .list({
      customer: org.stripeCustomerId,
    })
    .then((paymentMethodsResponse) => {
      hasPaymentMethod = paymentMethodsResponse.data.length > 0;
    })
    .catch((e) => {
      logger.error(e, "Failed to get payment methods from Stripe");
    });

  const item = subscription.items?.data?.[0];

  const update: Partial<OrganizationInterface> = {
    subscription: {
      id: subscription.id,
      qty: item?.quantity || 1,
      trialEnd: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null,
      status: subscription.status,
      current_period_end: subscription.current_period_end,
      cancel_at: subscription.cancel_at,
      canceled_at: subscription.canceled_at,
      cancel_at_period_end: subscription.cancel_at_period_end,
      planNickname: item?.plan?.nickname,
      priceId: item?.price?.id,
      hasPaymentMethod: hasPaymentMethod,
    },
    priceId: item?.price?.id,
  };

  // update free trial status
  if (subscription.status === "trialing") {
    if (org && !org.freeTrialDate) {
      update.freeTrialDate = new Date();
    }
  }

  await updateOrganizationByStripeId(stripeCustomerId, update);

  return { organization: org, subscription, hasPaymentMethod };
}

export function formatBrandName(name: string): string {
  return BRAND_NAMES[name] || name; // Fallback to the original name if not found
}
