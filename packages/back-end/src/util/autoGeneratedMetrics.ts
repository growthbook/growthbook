const eventsArray = [
  { name: "Signed Up", plural: "Sign Ups" },
  { name: "Placed Order", plural: "Orders Placed" },
  { name: "Subscribed", plural: "Subscriptions" },
  { name: "Page Viewed", plural: "Page Views" },
  { name: "Products Searched", plural: "Products Searches" },
  { name: "Product List Viewed", plural: "Count of Product List Views" },
  { name: "Product List Filtered", plural: "Count of Product List Filters" },
  { name: "Promotion Viewed", plural: "Promotion Views" },
  { name: "Promotion Clicked", plural: "Promotion Clicks" },
  { name: "Product Clicked", plural: "Product Clicks" },
  { name: "Product Viewed", plural: "Product Views" },
  { name: "Product Added", plural: "Product Additions" },
  { name: "Product Removed", plural: "Products Removals" },
  { name: "Cart Viewed", plural: "Carts Views" },
  { name: "Checkout Started", plural: "Checkouts Started" },
  { name: "Checkout Step Viewed", plural: "Checkout Step Views" },
  { name: "Checkout Step Completed", plural: "Checkout Step Completes" },
  { name: "Payment Info Entered", plural: "Count of Payment Info Entered" },
  { name: "Order Completed", plural: "Count of Completed Orders" },
  { name: "Order Updated", plural: "Count of Orders Updates" },
  { name: "Order Refunded", plural: "Count of Orders Refunds" },
  { name: "Order Cancelled", plural: "Count of Order Cancelletions" },
  { name: "Coupon Entered", plural: "Count of Coupons Entered" },
  { name: "Coupon Applied", plural: "Count of Coupons Applied" },
  { name: "Coupon Denied", plural: "Count of Coupons Denied" },
  { name: "Coupon Removed", plural: "Count of Coupons Removed" },
  {
    name: "Product Added to Wishlist",
    plural: "Count of Product Adds to Wishlist",
  },
  {
    name: "Product Removed from Wishlist",
    plural: "Count of Product Removals from Wishlist",
  },
  {
    name: "Wishlist Product Added to Cart",
    plural: "Count of Wishlist Product Added to Cart",
  },
  { name: "Product Shared", plural: "Product Shares" },
  { name: "Cart Shared", plural: "Cart Shares" },
  { name: "Product Reviewed", plural: "Product Reviews" },
];

const events = new Map<string, string>();

eventsArray.forEach((event) => {
  events.set(event.name, event.plural);
});

export function getPluralizedMetricName(metricName: string): string {
  return events.get(metricName) || `Count of ${metricName}`;
}
