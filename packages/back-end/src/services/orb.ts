import Orb from "orb-billing";
import { addUsageAlert } from "back-end/src/models/UsageAlertsModel";
import { ORB_API_KEY } from "back-end/src/util/secrets";
import { getOrganizationById } from "./organizations";

export const orb = new Orb({
  //MKTODO: Use an env variable here
  apiKey: ORB_API_KEY,
});

export async function addUsageWarning(payload: any) {
  console.log("hit the addUsageWarning function");
  const orgId = payload.subscription.customer.externalId;
  // Validate this is an org within GB
  if (!orgId || (await getOrganizationById(orgId))) {
    throw new Error(`OrgId: ${orgId} not found`);
  }

  const quantityThreshold = payload.quantity_threshold;

  //MKTODO: Should we fetch the price data for the subscription to avoid using out-of-date data?
  // Get price data for the billable metric that hit an alert threshold - if so, we can use priceData.id
  const priceData = payload.subscription.plan.prices.findOne(
    (price: any) => price.billable_metric.id === payload.billable_metric_id
  );

  // Then, we need to get the max units allowed in the free tier
  const maxFreeThreshold = priceData.tiered_config.tiers.findOne(
    (tier: any) =>
      tier.first_unit === 0.0 && tier.last_unit <= quantityThreshold
  ).last_unit;

  if (!maxFreeThreshold) {
    // This isn't a threshold notice for the included usage, so just return
    return;
  }

  await addUsageAlert({
    id: payload.id,
    percentUsed: quantityThreshold / maxFreeThreshold,
    orgId,
    timeframeEnd: payload.timeframe_end,
    meterName: priceData.name,
  });
}
