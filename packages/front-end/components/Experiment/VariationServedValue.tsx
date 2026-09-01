import { Box, Flex } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import ForceSummary from "@/components/Features/ForceSummary";
import Text from "@/ui/Text";
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

  // A block value needs the full width of the card; a short scalar reads
  // better on the label's own line.
  const stacked = feature.valueType === "json" || (value ?? "").includes("\n");

  const label = (
    // The dot belongs to the label, so it centres against "Serves:" while the
    // pair as a whole sits at the top of a tall value.
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

  // The same renderer the Feature Flag rules use — config-backed values,
  // sparse patches and JSON all read the same way there.
  const rendered = (
    <ForceSummary
      label={null}
      value={value ?? ""}
      feature={feature}
      sparse={sparse}
      // Denser than the rules page: the card is a third of its width, and
      // ValueDisplay caps the block at 150px with its own scrollbar.
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
        // Centred, not start-aligned: a one-line value has no first line to
        // pin to, and the value fills the row so its copy button — positioned
        // to the block's right edge — lands at the edge of the card.
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
