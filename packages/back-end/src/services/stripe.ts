import { STRIPE_SECRET } from "../util/secrets";
import { Stripe } from "stripe";
import { updateOrganizationByStripeId } from "../models/OrganizationModel";
const stripe = new Stripe(STRIPE_SECRET || "", { apiVersion: "2020-08-27" });

export async function updateSubscription(
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
      id: subscription.id,
      qty: subscription.items.data[0].quantity || 1,
      trialEnd: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null,
      status: subscription.status,
    },
    priceId: subscription.items.data[0].price.id,
  });
}

export async function updateStripeSubscription(
  subscriptionId: string,
  qty: number
) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

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

  await updateSubscription(updatedSubscription);
}
