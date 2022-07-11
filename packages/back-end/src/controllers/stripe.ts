import { Request, Response } from "express";
import {
  STRIPE_SECRET,
  APP_ORIGIN,
  STRIPE_PRICE,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_DEFAULT_COUPON,
} from "../util/secrets";
import { Stripe } from "stripe";
import { AuthRequest } from "../types/AuthRequest";
import {
  updateOrganization,
  updateOrganizationByStripeId,
} from "../models/OrganizationModel";
import { createOrganization } from "../models/OrganizationModel";
import { getOrgFromReq } from "../services/organizations";
const stripe = new Stripe(STRIPE_SECRET || "", { apiVersion: "2020-08-27" });

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
}
export async function postStartTrial(
  req: AuthRequest<{ qty: number; name: string }>,
  res: Response
) {
  const { qty, name } = req.body;

  // If user already has a subscription, return immediately
  if (req.organization?.subscription?.id) {
    return res.status(200).json({
      status: 200,
    });
  }

  try {
    // Create organization first if needed
    if (!req.organization) {
      if (name.length < 3) {
        throw new Error("Company name must be at least 3 characters long");
      }
      req.organization = await createOrganization(
        req.email || "",
        req.userId || "",
        name,
        ""
      );
    }

    // Create customer in Stripe if not exists
    if (!req.organization.stripeCustomerId) {
      const resp = await stripe.customers.create({
        email: req.email || "",
        name: req.name || "",
        metadata: {
          user: req.userId || "",
          organization: req.organization.id,
        },
      });
      req.organization.stripeCustomerId = resp.id;

      await updateOrganization(req.organization.id, {
        stripeCustomerId: resp.id,
      });
    }

    // Start subscription trial without payment method
    const subscription = await stripe.subscriptions.create({
      customer: req.organization.stripeCustomerId,
      coupon: STRIPE_DEFAULT_COUPON,
      collection_method: "charge_automatically",
      trial_from_plan: true,
      metadata: {
        user: req.userId || "",
        organization: req.organization.id,
      },
      items: [
        {
          price: STRIPE_PRICE,
          quantity: qty,
        },
      ],
    });

    // Save in Mongo
    await updateSubscription(subscription);

    res.status(200).json({ status: 200 });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message,
    });
  }
}

export async function postNewSubscription(
  req: AuthRequest<{ qty: number; email: string }>,
  res: Response
) {
  const { qty, email } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      payment_method_types: ["card"],
      line_items: [
        {
          price: STRIPE_PRICE,
          quantity: qty,
        },
      ],
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
      const { subscription } = event.data
        .object as Stripe.Response<Stripe.Checkout.Session>;
      if (subscription) {
        updateSubscription(subscription);
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
    case "customer.subscription.updated": {
      const subscription = event.data
        .object as Stripe.Response<Stripe.Subscription>;
      if (subscription) {
        updateSubscription(subscription);
      }
      break;
    }
  }

  res.status(200).send("Ok");
}
