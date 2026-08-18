import { Flex, Separator } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import ValueDisplay from "@/components/Features/ValueDisplay";
import Link from "@/ui/Link";
import Metadata from "@/ui/Metadata";
import Text from "@/ui/Text";

/**
 * The Feature Flag value a variation serves, shown on its variation card.
 *
 * Only meaningful when the experiment has exactly one implementation and it is
 * a Feature Flag — with several flags, or a flag alongside visual changes or a
 * redirect, "the" served value doesn't exist and the card would state one
 * arbitrarily. Callers decide that; see `soleLinkedFeature`.
 */
export default function VariationServedValue({
  value,
  feature,
  sparse,
  onEdit,
}: {
  value: string;
  feature: FeatureInterface;
  sparse?: boolean;
  onEdit?: () => void;
}) {
  return (
    <>
      <Separator size="4" my="3" />
      <Flex align="center" justify="between" gap="2">
        <Metadata
          label="Serves"
          size="sm"
          value={
            // Not ForceSummary — its "SERVE" prefix would double the label.
            <ValueDisplay
              value={value}
              type={feature.valueType}
              sparse={sparse}
              defaultValue={feature.defaultValue}
              showCopyButton={false}
              fullStyle={{ maxHeight: 60, overflowY: "auto" }}
            />
          }
        />
        {onEdit ? (
          <Link onClick={onEdit}>
            <Text size="sm" weight="semibold">
              Edit
            </Text>
          </Link>
        ) : null}
      </Flex>
    </>
  );
}
