import { Flex } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import ValueDisplay from "@/components/Features/ValueDisplay";
import Metadata from "@/ui/Metadata";
import UnpublishedDot from "@/components/Experiment/UnpublishedDot";

// The value a variation serves. Only meaningful when the experiment's sole
// implementation is a Feature Flag; callers decide that.
export default function VariationServedValue({
  value,
  feature,
  sparse,
  isDraft,
  draftName,
  draftNote,
}: {
  value?: string;
  feature?: FeatureInterface;
  sparse?: boolean;
  /** The value shown is an unpublished draft, not what is live. */
  isDraft?: boolean;
  /** Names the draft it comes from. Omitted for a managed flag, which has one. */
  draftName?: string;
  /** Other drafts this readout is not showing. */
  draftNote?: string;
}) {
  if (!feature) return null;

  return (
    <Flex align="center" justify="between" gap="2" mt="3">
      <Flex align="center" gap="1" minWidth="0">
        {isDraft && (
          <UnpublishedDot
            tooltip={
              draftName
                ? `Unpublished value in ${draftName}`
                : "Unpublished draft value"
            }
            note={draftNote}
          />
        )}
        <Metadata
          label="Serves"
          value={
            // Not ForceSummary — its "SERVE" prefix would double the label.
            <ValueDisplay
              value={value ?? ""}
              type={feature.valueType}
              sparse={sparse}
              defaultValue={feature.defaultValue}
              showCopyButton={false}
              fullStyle={{ maxHeight: 60, overflowY: "auto" }}
            />
          }
        />
      </Flex>
    </Flex>
  );
}
