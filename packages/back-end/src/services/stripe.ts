import { Stripe } from "stripe";
import { STRIPE_SECRET } from "../util/secrets";
import {
  updateOrganization,
  updateOrganizationByStripeId,
} from "../models/OrganizationModel";
import { OrganizationInterface } from "../../types/organization";
import { logger } from "../util/logger";
import { isActiveSubscriptionStatus } from "../util/organization.util";

export const stripe = new Stripe(STRIPE_SECRET || "", {
  apiVersion: "2020-08-27",
});

/**
 * @name updateSubscriptionInDb
 * @description This function updates the subscription in the database. (organization.subscription)
 */
export async function updateSubscriptionInDb(
  subscription: string | Stripe.Subscription
) {
  // Always get the latest subscription data from the API
  subscription = await stripe.subscriptions.retrieve(
    typeof subscription === "string" ? subscription : subscription.id,
    { expand: ["plan"] }
  );

  if ("ignore_webhooks" in subscription.metadata) {
    return;
  }

  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const item = subscription.items?.data?.[0];

  await updateOrganizationByStripeId(stripeCustomerId, {
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
    },
    priceId: item?.price?.id,
  });
}

const priceData: {
  [key: string]: Stripe.Price;
} = {};
export async function getPrice(priceId: string): Promise<Stripe.Price | null> {
  if (priceData[priceId]) return priceData[priceId];

  if (!STRIPE_SECRET) {
    return null;
  }

  try {
    priceData[priceId] = await stripe.prices.retrieve(priceId, {
      expand: ["tiers"],
    });
    return priceData[priceId];
  } catch (e) {
    logger.error(e, "Failed to get price data from Stripe");
    return null;
  }
}

const discountData: {
  [key: string]: Stripe.Coupon;
} = {};
export async function getCoupon(
  discountCode?: string
): Promise<Stripe.Coupon | null> {
  if (!discountCode) return null;
  if (discountData[discountCode]) return discountData[discountCode];

  if (!STRIPE_SECRET) return null;

  try {
    discountData[discountCode] = await stripe.coupons.retrieve(discountCode);
    return discountData[discountCode];
  } catch (e) {
    logger.error(e, "Failed to get coupon data from Stripe");
    return null;
  }
}

export function hasActiveSubscription(org: OrganizationInterface) {
  return isActiveSubscriptionStatus(org.subscription?.status);
}

export async function getStripeCustomerId(org: OrganizationInterface) {
  if (org.stripeCustomerId) return org.stripeCustomerId;

  if (!STRIPE_SECRET) {
    throw new Error("Missing Stripe secret");
  }

  // Create a new Stripe customer and save it in the organization object
  const { id } = await stripe.customers.create({
    metadata: {
      growthBookId: org.id,
      ownerEmail: org.ownerEmail,
    },
    name: org.name,
  });

  await updateOrganization(org.id, {
    stripeCustomerId: id,
  });

  return id;
}
