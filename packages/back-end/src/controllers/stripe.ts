import { Request, Response } from "express";
import {
  STRIPE_SECRET,
  APP_ORIGIN,
  STRIPE_5_PRICE,
  STRIPE_10_PRICE,
  STRIPE_WEBHOOK_SECRET,
} from "../util/secrets";
import { Stripe } from "stripe";
import { AuthRequest } from "../types/AuthRequest";
import {
  updateOrganization,
  updateOrganizationByStripeId,
  findOrganizationByStripeCustomerId,
} from "../models/OrganizationModel";
import { getOrgFromReq } from "../services/organizations";
const stripe = new Stripe(STRIPE_SECRET || "", { apiVersion: "2020-08-27" });
import { getUsersByIds } from "../services/users";

async function updateSubscription(subscription: string | Stripe.Subscription) {
  // Make sure we have the full subscription object
  if (typeof subscription === "string") {
    subscription = await stripe.subscriptions.retrieve(subscription);
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
  });
  console.log(`org was updated at ${new Date()}`);
}

export async function postNewSubscription(
  req: AuthRequest<{ qty: number; email: string; organizationId: string }>,
  res: Response
) {
  const { qty, email, organizationId } = req.body;

  // Getting this as I imagine we'll use it to define an org's price as standard (STRIPE_5_PRICE) or special (STRIPE_10_PRICE)
  const { org } = getOrgFromReq(req);

  if (!organizationId) {
    res.status(400).json({
      status: 400,
      message: "No organization created",
    });
  }

  const getPrice = () => {
    if (org) {
      return STRIPE_5_PRICE;
    } else {
      return STRIPE_10_PRICE;
    }
  };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      payment_method_types: ["card"],
      client_reference_id: organizationId,
      line_items: [
        {
          price: getPrice(),
          quantity: qty,
        },
      ],
      allow_promotion_codes: true,
      success_url: "http://localhost:3000/settings/team",
      cancel_url: "http://localhost:3000/settings/team",
    });
    res.status(200).json({
      status: 200,
      session,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function getSubscriptionData(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);

  const subscriptionId = org.subscription?.id;

  if (!subscriptionId) {
    res.status(400).json({
      status: 400,
      message: "No organization found",
    });
  } else {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);

      res.status(200).json({
        status: 200,
        subscription,
      });
    } catch (e) {
      res.status(400).json({
        status: 400,
        message: e.message,
      });
    }
  }
}

export async function postCreateBillingSession(
  req: AuthRequest,
  res: Response
) {
  try {
    req.checkPermissions("organizationSettings");

    const { org } = getOrgFromReq(req);
    if (!org.stripeCustomerId) {
      throw new Error("Missing customer id");
    }

    const { url } = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${APP_ORIGIN}/settings`,
    });

    res.status(200).json({
      status: 200,
      url,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function postUpdateStripeSubscription(
  req: AuthRequest<{
    qty: number;
    organizationId: string;
    subscriptionId: string;
  }>,
  res: Response
) {
  const { qty, organizationId, subscriptionId } = req.body;

  try {
    req.checkPermissions("organizationSettings");

    if (!organizationId) {
      throw new Error("Missing customer id");
    }

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

    res.status(200).json({
      status: 200,
      updatedSubscription,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function postWebhook(req: Request, res: Response) {
  const payload: Buffer = req.body;
  const sig = req.headers["stripe-signature"];
  if (!sig) {
    return res.status(400).send("Missing signature");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(payload, sig);
    console.error(err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const { subscription, client_reference_id, customer } = event.data
        .object as Stripe.Response<Stripe.Checkout.Session>;

      if (client_reference_id && customer && typeof customer === "string") {
        await updateOrganization(client_reference_id, {
          stripeCustomerId: customer,
        });

        if (subscription) {
          updateSubscription(subscription);
        }
      } else {
        console.error("Unable to find & updated existing organization"); //TODO: As this is a webhook, these errors should probably alert/bubble up somewhere
        res.status(400).json({
          status: 400,
          message: "Unable to find & updated existing organization",
        });
      }
      break;
    }

    case "invoice.paid":
    case "invoice.payment_failed": {
      const { subscription } = event.data
        .object as Stripe.Response<Stripe.Invoice>;
      if (subscription) {
        updateSubscription(subscription);
      }
      break;
    }

    case "customer.subscription.deleted":
    case "subscription_scheduled.canceled":
    case "customer.subscription.updated": {
      const subscription = event.data
        .object as Stripe.Response<Stripe.Subscription>;

      // Get the current subscription data instead of relying on a potentially outdated event
      const currentStripeSubscriptionData = await stripe.subscriptions.retrieve(
        subscription.id
      );

      // Get stripeCustomerId
      const stripeCustomerId =
        typeof currentStripeSubscriptionData.customer === "string"
          ? currentStripeSubscriptionData.customer
          : currentStripeSubscriptionData.customer.id;

      // Get the organization connected to stripeCustomerId
      const currentDbSubscription = await findOrganizationByStripeCustomerId(
        stripeCustomerId
      );

      // If Stripe's status, trialEnd, or subscriptionId's don't match our DB, update our DB.
      if (
        currentStripeSubscriptionData.status !==
          currentDbSubscription?.subscription?.status ||
        currentStripeSubscriptionData.trial_end !==
          currentDbSubscription?.subscription?.trialEnd ||
        currentStripeSubscriptionData.id !==
          currentDbSubscription.subscription.id
      ) {
        updateSubscription(currentStripeSubscriptionData);
      }

      // This is a bit weird, but the organization.members array can have duplicates, so this just returns an array of unique users.
      const users = await getUsersByIds(
        currentDbSubscription?.members?.map((m) => m.id) || []
      );

      const activeAndInvitedMembers =
        (currentDbSubscription?.invites?.length || 0) + (users.length || 0);

      // If Stripe's qty doesn't match our DB, update Stripe's subscription.
      if (
        currentStripeSubscriptionData.items.data[0].quantity !==
        activeAndInvitedMembers
      ) {
        await stripe.subscriptions.update(subscription.id, {
          items: [
            {
              id: subscription.items.data[0].id,
              quantity: activeAndInvitedMembers,
            },
          ],
        });
      }
      break;
    }
  }

  res.status(200).send("Ok");
}
