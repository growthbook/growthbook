import Orb from "orb-billing";
import { addUsageAlert } from "back-end/src/models/UsageAlertsModel";
import { ORB_API_KEY } from "back-end/src/util/secrets";
import { SubscriptionUsageExceededEvent } from "back-end/src/types/Orb";
import { getOrganizationById } from "./organizations";

export const orb = new Orb({
  apiKey: ORB_API_KEY,
});

function findMaxFreeThreshold(priceData: Orb.Prices.Price.TieredPrice) {
  return priceData.tiered_config.tiers.find(
    (tier) => tier.first_unit === 0.0 && tier.unit_amount === "0.00"
  )?.last_unit;
}

export async function addUsageWarning(payload: SubscriptionUsageExceededEvent) {
  const orgId = payload.subscription.customer.external_customer_id;
  // Validate this is an org within GB
  if (!orgId || (await getOrganizationById(orgId))) {
    throw new Error(`OrgId: ${orgId} not found`);
  }

  const quantityThreshold = payload.properties.quantity_threshold;

  //MKTODO: Should we fetch the price data for the subscription to avoid using out-of-date data
  // - I don't think the plans/prices will change enough to warrant a round trip call
  const priceData = payload.subscription.plan.prices.find(
    (price) =>
      price.billable_metric?.id === payload.properties.billable_metric_id &&
      price.price_type === "usage_price"
  );

  if (!priceData)
    throw new Error(
      `Unable to locate price for billable_metric_id: ${payload.properties.billable_metric_id}`
    );

  // Then, we need to get the max units allowed in the free tier to calculate percentUsed
  const maxFreeThreshold = findMaxFreeThreshold(
    priceData as Orb.Prices.Price.TieredPrice
  );

  if (!maxFreeThreshold) {
    // This is the last tier and doesn't have a maximum threshold
    return;
  }

  await addUsageAlert({
    id: payload.id,
    percentUsed: quantityThreshold / maxFreeThreshold,
    orgId,
    timeframeEnd: new Date(payload.properties.timeframe_end),
    meterName: priceData.item.name,
  });
}
