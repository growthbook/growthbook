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

// expand as we add more supported trackers:
export const pluginSupportedTrackers = ["segment", "GA4", "GTM", "growthbook"];

const EventTrackerSelector: React.FC<{
  eventTracker: string;
  setEventTracker: (value: string) => void;
}> = ({ eventTracker, setEventTracker }) => {
  return (
    <div className="form-inline mb-3">
      <SelectField
        label="Event Tracking System"
        labelClassName="mr-2"
        options={eventTrackerOptions}
        defaultValue="GA4"
        sort={false}
        value={eventTracker}
        onChange={(value) => setEventTracker(value)}
      />
    </div>
  );
};

export default EventTrackerSelector;
