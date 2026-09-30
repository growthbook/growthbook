import { SavedGroupFormat, SDKLanguage } from "shared/types/sdk-connection";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { Flex } from "@radix-ui/themes";
import SelectField from "@/components/Forms/SelectField";
import Text from "@/ui/Text";
import { useUser } from "@/services/UserContext";
import {
  SAVED_GROUP_FORMAT_LABELS,
  SavedGroupReferencesLabel,
} from "@/components/Features/SDKConnections/sdkConnectionSettingLabels";

/**
 * The full form's "Pass Saved Groups by reference" select, verbatim: Off / ID
 * Lists only / All Saved Groups, with its plan and SDK-version notes. Shared by
 * the create and per-card edit modals so the two can't drift; callers own
 * submission and run `sanitizeSavedGroupFormat`.
 */
export default function SavedGroupFormatField({
  value,
  onChange,
  languages,
  sdkVersion,
  remoteEvalEnabled,
  storedFormat,
}: {
  value: SavedGroupFormat;
  onChange: (format: SavedGroupFormat) => void;
  languages: SDKLanguage[];
  sdkVersion?: string;
  /** Only changes the warning copy, as in the full form. */
  remoteEvalEnabled: boolean;
  /** The persisted format when editing; leave unset on create. */
  storedFormat?: SavedGroupFormat;
}) {
  const { hasCommercialFeature } = useUser();
  const hasLargeSavedGroupFeature = hasCommercialFeature("large-saved-groups");

  const currentCaps = getConnectionSDKCapabilities(
    { languages, sdkVersion },
    "min-ver-intersection",
  );
  const latestCaps = getConnectionSDKCapabilities(
    { languages, sdkVersion },
    "max-ver-intersection",
  );
  // v2 covers every Saved Group type. v1 covers ID Lists only, so Condition
  // Groups keep shipping inline until the SDK is upgraded.
  const supportsAllSavedGroupTypes = currentCaps.includes(
    "savedGroupReferencesV2",
  );
  // Offer v2 only when upgrading the SDK can reach it.
  const allSavedGroupTypesAvailable = latestCaps.includes(
    "savedGroupReferencesV2",
  );
  const savedAsAllSavedGroupTypes = storedFormat === "referencesV2";

  return (
    <SelectField
      label={
        (
          <SavedGroupReferencesLabel remoteEvalEnabled={remoteEvalEnabled} />
        ) as unknown as string
      }
      sort={false}
      isClearable={false}
      isSearchable={false}
      value={value}
      onChange={(val) => onChange(val as SavedGroupFormat)}
      options={[
        { value: "inline", label: SAVED_GROUP_FORMAT_LABELS.inline },
        {
          value: "referencesV1",
          label: SAVED_GROUP_FORMAT_LABELS.referencesV1,
          isDisabled: !hasLargeSavedGroupFeature,
        },
        ...(allSavedGroupTypesAvailable || savedAsAllSavedGroupTypes
          ? [
              {
                value: "referencesV2",
                label: SAVED_GROUP_FORMAT_LABELS.referencesV2,
                // An SDK downgrade on a saved connection keeps this
                // selectable, so the choice shows a warning rather than
                // being silently dropped, and re-upgrading the SDK
                // resumes v2. That only applies to a connection already
                // on v2, never to a new one, and never without the plan.
                isDisabled:
                  !hasLargeSavedGroupFeature ||
                  (!supportsAllSavedGroupTypes && !savedAsAllSavedGroupTypes),
              },
            ]
          : []),
      ]}
      formatOptionLabel={({ value, label }, { context }) => {
        let note: string | null = null;
        if (context === "menu" && value !== "inline") {
          if (!hasLargeSavedGroupFeature) note = "Enterprise";
          else if (value === "referencesV2")
            note = supportsAllSavedGroupTypes
              ? "Recommended"
              : allSavedGroupTypesAvailable
                ? "Needs a newer SDK"
                : null;
        }
        return (
          <Flex justify="between" gap="3">
            <span>{label}</span>
            {note && (
              <Text size="sm" color="text-low">
                {note}
              </Text>
            )}
          </Flex>
        );
      }}
      error={
        value === "referencesV2" && !supportsAllSavedGroupTypes
          ? allSavedGroupTypesAvailable
            ? "This SDK version cannot pass all Saved Groups by reference, so it passes ID Lists by reference until you upgrade it."
            : "This SDK cannot pass all Saved Groups by reference, so it passes ID Lists by reference."
          : undefined
      }
      errorLevel="warning"
    />
  );
}
