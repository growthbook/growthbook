import {
  DEFAULT_DATA_REGION,
  getDataRegionLabel,
  getEventIngestorHost,
  useEventForwarderRegions,
} from "@/services/dataRegions";
import Callout from "@/ui/Callout";

// The environment has an Event Forwarder in both data regions, so the snippet
// leaves the host out and events go to the default region only
export default function EventIngestorRegionWarning({
  environment,
  eventTracker,
}: {
  environment?: string;
  eventTracker: string;
}) {
  const regions = useEventForwarderRegions(environment);
  const other = regions.find((r) => r !== DEFAULT_DATA_REGION);
  if (eventTracker !== "growthbook" || regions.length < 2 || !other) {
    return null;
  }
  return (
    <Callout status="warning" mb="3">
      This environment has an Event Forwarder in{" "}
      {regions.map(getDataRegionLabel).join(" and in ")}. This code sends events
      to {getDataRegionLabel(DEFAULT_DATA_REGION)}. To send them to{" "}
      {getDataRegionLabel(other)}, set the tracking plugin&apos;s ingestor host
      to <code>{getEventIngestorHost(other)}</code>.
    </Callout>
  );
}
