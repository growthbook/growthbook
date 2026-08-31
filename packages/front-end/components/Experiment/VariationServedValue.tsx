import { Flex } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import ValueDisplay from "@/components/Features/ValueDisplay";
import Metadata from "@/ui/Metadata";
import UnpublishedDot from "@/components/Experiment/UnpublishedDot";

/**
 * The Feature Flag value a variation serves — or, when the experiment has no
 * Only meaningful when the experiment's sole implementation is a Feature Flag;
 * callers decide that.
 */
export default function VariationServedValue({
  value,
  feature,
  sparse,
  isDraft,
}: {
  value?: string;
  feature?: FeatureInterface;
  sparse?: boolean;
  /** The value shown is an unpublished draft, not what is live. */
  isDraft?: boolean;
}) {
  if (!feature) return null;

  return (
    <Flex align="center" justify="between" gap="2" mt="3">
      <Flex align="center" gap="1" minWidth="0">
        {isDraft && <UnpublishedDot tooltip="Unpublished draft value" />}
        <Metadata
          label="Serves"
          size="sm"
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
