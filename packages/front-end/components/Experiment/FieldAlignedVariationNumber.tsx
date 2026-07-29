import { Box, Flex } from "@radix-ui/themes";
import VariationNumber from "@/ui/VariationNumber";

// Height of a standard `Field` text input (Bootstrap `.form-control`). The badge
// is vertically centered within this height so it lines up with the input rather
// than the label rendered above it.
const FIELD_INPUT_HEIGHT = "35px";

/**
 * Renders a `VariationNumber` badge that lines up with a sibling `Field`'s input.
 * An invisible label-height spacer offsets the badge past the field's label, and
 * the badge is centered within the input height.
 */
export default function FieldAlignedVariationNumber({
  number,
}: {
  number: number;
}) {
  return (
    <Box>
      <label aria-hidden="true" style={{ visibility: "hidden" }}>
        &nbsp;
      </label>
      <Flex align="center" height={FIELD_INPUT_HEIGHT}>
        <VariationNumber number={number} />
      </Flex>
    </Box>
  );
}
