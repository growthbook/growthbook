import React from "react";
import SelectField from "@/components/Forms/SelectField";

const eventTrackerOptions = [
  { label: "GrowthBook Managed Warehouse", value: "growthbook" },
  { label: "Google Analytics 4", value: "GA4" },
  { label: "Google Analytics 4 via GTM", value: "GTM" },
  { label: "Segment.io", value: "segment" },
  { label: "RudderStack", value: "rudderstack" },
  { label: "Amplitude", value: "amplitude" },
  { label: "Mixpanel", value: "mixpanel" },
  { label: "Snowplow", value: "snowplow" },
  { label: "Matomo", value: "matomo" },
  { label: "Other", value: "other" },
];

// The above trackers are all implemented via browser globals (window.gtag,
// analytics.track, etc.), so they don't apply to back-end SDKs.
export const backendEventTrackerOptions = [
  { label: "GrowthBook Managed Warehouse", value: "growthbook" },
  { label: "Other", value: "other" },
];

// expand as we add more supported trackers:
export const pluginSupportedTrackers = ["segment", "GA4", "GTM", "growthbook"];

const EventTrackerSelector: React.FC<{
  eventTracker: string;
  setEventTracker: (value: string) => void;
  options?: { label: string; value: string }[];
}> = ({ eventTracker, setEventTracker, options = eventTrackerOptions }) => {
  return (
    <div className="form-inline mb-3">
      <SelectField
        size="legacy"
        label="Event Tracking System"
        labelClassName="mr-2"
        options={options}
        defaultValue="GA4"
        sort={false}
        value={eventTracker}
        onChange={(value) => setEventTracker(value)}
      />
    </div>
  );
};

export default EventTrackerSelector;
