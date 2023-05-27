const eventsArray = [
  { name: "Signed Up", plural: "Count of Sign Ups" },
  { name: "Placed Order", plural: "Count of Orders" },
  { name: "Subscribed", plural: "Count of Subscriptions" },
  { name: "Page Viewed", plural: "Count of Page Views" },
];

const events = new Map<string, string>();

eventsArray.forEach((event) => {
  events.set(event.name, event.plural);
});

export function getMetricPlural(metricName: string): string {
  return events.get(metricName) || `Count of ${metricName}`;
}
