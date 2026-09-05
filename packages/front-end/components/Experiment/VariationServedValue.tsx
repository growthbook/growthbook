import { Box, Flex } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import ForceSummary from "@/components/Features/ForceSummary";
import Text from "@/ui/Text";
import UnpublishedDot from "@/components/Experiment/UnpublishedDot";

// Only meaningful when the sole implementation is a Feature Flag.
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

  // A block value needs the full width.
  const stacked = feature.valueType === "json" || (value ?? "").includes("\n");

  const label = (
    <Flex align="center" gap="1" flexShrink="0">
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
      <Text weight="medium" color="text-high">
        Serves:
      </Text>
    </Flex>
  );

  // The Feature Flag rules' renderer.
  const rendered = (
    <ForceSummary
      label={null}
      value={value ?? ""}
      feature={feature}
      sparse={sparse}
      // Denser than the rules page: the card is a third of the width.
      fontSize="0.75rem"
      lineHeight={1.35}
    />
  );

  return (
    <Flex direction="column" gap="1" mt="3" minWidth="0">
      {stacked ? (
        <>
          {label}
          <Box width="100%" minWidth="0">
            {rendered}
          </Box>
        </>
      ) : (
        <Flex align="center" gap="1" minWidth="0">
          {label}
          <Box flexGrow="1" minWidth="0">
            {rendered}
          </Box>
        </Flex>
      )}
    </Flex>
  );
}
