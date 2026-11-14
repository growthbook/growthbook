import { Box, Flex } from "@radix-ui/themes";
import { PiMagicWand } from "react-icons/pi";
import FieldIndicator, {
  CopyFieldIndicator,
  FieldIndicatorCorner,
} from "@/ui/FieldIndicator";

const fieldStyle = {
  border: "1px solid var(--gray-a7)",
  borderRadius: "var(--radius-2)",
  padding: "6px 8px",
  width: 320,
};

export default function FieldIndicatorStories() {
  return (
    <Flex direction="column" gap="5">
      <Box>
        Indicators inside a single-line field
        <Flex
          align="center"
          justify="between"
          className="gb-field-indicator-host"
          style={fieldStyle}
        >
          my-feature-key
          <Flex align="center">
            <FieldIndicator label="Suggest a key" onClick={() => undefined}>
              <PiMagicWand />
            </FieldIndicator>
            <CopyFieldIndicator value="my-feature-key" />
          </Flex>
        </Flex>
      </Box>

      <Box>
        Revealed only while the field is hovered or focused
        <Flex
          align="center"
          justify="between"
          className="gb-field-indicator-host"
          style={fieldStyle}
        >
          hover me
          <CopyFieldIndicator value="hover me" reveal />
        </Flex>
      </Box>

      <Box>
        A multi-line field&apos;s indicators, in its bottom-right corner
        <Box
          className="gb-field-indicator-host"
          style={{ ...fieldStyle, height: 96, whiteSpace: "pre" }}
        >
          {'{\n  "layout": "list"\n}'}
          <FieldIndicatorCorner>
            <CopyFieldIndicator value={'{"layout": "list"}'} />
          </FieldIndicatorCorner>
        </Box>
      </Box>
    </Flex>
  );
}
