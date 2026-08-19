import { Box, Flex } from "@radix-ui/themes";
import { FaRegFlag } from "react-icons/fa";
import Avatar from "@/ui/Avatar";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Text from "@/ui/Text";

/**
 * The promoted way to add an implementation: one Feature Flag this experiment
 * owns end to end. Mirrors `AddLinkedChangeRow`'s layout so the two read as one
 * list, but sits in its own box above them with a solid CTA — the manual
 * options below are the alternative, not the default.
 */
export default function AddManagedFlagOption({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <Box className="appbox mb-0" p="4" mt="2" mb="0">
      <Flex align="center" justify="between" gap="3" width="100%">
        <Flex align="center" direction="row" flexGrow="1" minWidth="0" gap="5">
          <Box width="150px" flexShrink="0">
            <Avatar
              radius="full"
              color="violet"
              size="md"
              variant="soft"
              mr="2"
            >
              <FaRegFlag />
            </Avatar>
            <Text size="lg" weight="semibold" color="text-high">
              Automatic
            </Text>
            <Box mt="1">
              <Badge label="Recommended" radius="full" color="violet" />
            </Box>
          </Box>
          <Box flexGrow="1" minWidth="0">
            <Text color="text-low">
              Set the value each variation serves and this Experiment creates
              the Feature Flag for you. Review and publishing stay on this page
              — no separate Feature Flag workflow.
            </Text>
          </Box>
        </Flex>
        <Box flexShrink="0">
          <Button onClick={onClick}>Set variation values</Button>
        </Box>
      </Flex>
    </Box>
  );
}
