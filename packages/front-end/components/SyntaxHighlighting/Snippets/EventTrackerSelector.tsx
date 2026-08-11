import React from "react";
import { Box } from "@radix-ui/themes";
import SelectField from "@/components/Forms/SelectField";
import RadioGroup from "@/ui/RadioGroup";
import Text from "@/ui/Text";

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
  // Fall back to "other" if the current value isn't one of the available
  // options (e.g. unset, or left over from a different language's tracker).
  const value = options.some((o) => o.value === eventTracker)
    ? eventTracker
    : "other";

  // A binary choice (e.g. the back-end tracker list) reads clearer as radios
  // than as a dropdown.
  if (options.length <= 2) {
    return (
      <Box mb="3">
        <Text as="div" weight="medium" mb="1">
          Event tracking system
        </Text>
        <RadioGroup
          value={value}
          setValue={setEventTracker}
          options={options}
        />
      </Box>
    );
  }

  return (
    <div className="form-inline mb-3">
      <SelectField
        size="legacy"
        label="Event tracking system"
        labelClassName="mr-2"
        options={options}
        sort={false}
        value={value}
        onChange={(value) => setEventTracker(value)}
      />
    </div>
  );
};

export default EventTrackerSelector;
