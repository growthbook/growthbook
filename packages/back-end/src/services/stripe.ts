import { STRIPE_SECRET } from "../util/secrets";
import { Stripe } from "stripe";
import { updateOrganizationByStripeId } from "../models/OrganizationModel";

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
  // Make sure we have the full subscription object
  if (typeof subscription === "string") {
    subscription = await stripe.subscriptions.retrieve(subscription, {
      expand: ["plan"],
    });
  }

  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  await updateOrganizationByStripeId(stripeCustomerId, {
    subscription: {
      id: subscription?.id,
      qty: subscription?.items?.data[0]?.quantity || 1,
      trialEnd: subscription?.trial_end
        ? new Date(subscription?.trial_end * 1000)
        : null,
      status: subscription?.status,
      current_period_end: subscription?.current_period_end,
      cancel_at: subscription?.cancel_at,
      canceled_at: subscription?.canceled_at,
      cancel_at_period_end: subscription?.cancel_at_period_end,
      planNickname: subscription?.items?.data[0]?.plan?.nickname,
      priceId: subscription?.items?.data[0]?.price?.id,
    },
    priceId: subscription?.items?.data[0]?.price?.id,
  });
}

/**
 * @name updateSubscriptionInStripe
 * @description This function updates the subscription in Stripe's system via Stripe's API.
 */
export async function updateSubscriptionInStripe(
  subscriptionId: string,
  qty: number
) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  // Only update subscription if the qty is different than what Stripe currently has
  if (qty !== subscription.items.data[0].quantity) {
    const updatedSubscription = await stripe.subscriptions.update(
      subscriptionId,
      {
        items: [
          {
            id: subscription.items.data[0].id,
            quantity: qty,
          },
        ],
      }
    );

    await updateSubscriptionInDb(updatedSubscription);
  }
}

const priceData: {
  [key: string]: Stripe.Price;
} = {};
export async function getPrice(priceId: string): Promise<Stripe.Price | null> {
  if (priceData[priceId]) return priceData[priceId];

  try {
    priceData[priceId] = await stripe.prices.retrieve(priceId, {
      expand: ["tiers"],
    });
    return priceData[priceId];
  } catch (e) {
    console.error(e);
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

  try {
    discountData[discountCode] = await stripe.coupons.retrieve(discountCode);
    return discountData[discountCode];
  } catch (e) {
    console.error(e);
    return null;
  }
}
