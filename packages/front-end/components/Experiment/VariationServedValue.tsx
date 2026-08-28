import { Box, Flex } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import ValueDisplay from "@/components/Features/ValueDisplay";
import Link from "@/ui/Link";
import Metadata from "@/ui/Metadata";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

/**
 * The Feature Flag value a variation serves — or, when the experiment has no
 * implementation yet and `onAdd` is given, the prompt to set one up. Only
 * meaningful when the experiment's sole implementation is a Feature Flag;
 * callers decide that.
 */
export default function VariationServedValue({
  value,
  feature,
  sparse,
  isDraft,
  onEdit,
  onAdd,
}: {
  value?: string;
  feature?: FeatureInterface;
  sparse?: boolean;
  /** The value shown is an unpublished draft, not what is live. */
  isDraft?: boolean;
  onEdit?: () => void;
  /** Renders the empty-state prompt instead of a value. */
  onAdd?: () => void;
}) {
  if (!feature) {
    if (!onAdd) return null;
    return (
      <Box mt="3">
        <Link onClick={onAdd}>
          <Text size="sm" weight="semibold">
            Add variation value
          </Text>
        </Link>
      </Box>
    );
  }

  return (
    <Flex align="center" justify="between" gap="2" mt="3">
      <Flex align="center" gap="1" minWidth="0">
        {isDraft && (
          <Tooltip content="Unpublished draft value">
            <Box
              style={{
                flexShrink: 0,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--amber-9)",
              }}
            />
          </Tooltip>
        )}
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
      {onEdit ? (
        <Link onClick={onEdit}>
          <Text size="sm" weight="semibold">
            Edit
          </Text>
        </Link>
      ) : null}
    </Flex>
  );
}
