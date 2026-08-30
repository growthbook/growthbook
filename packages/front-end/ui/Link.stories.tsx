import { Box, Flex } from "@radix-ui/themes";
import Link from "./Link";

export default function LinkStories() {
  return (
    <Flex direction="column" gap="3">
      <Box>
        Here we have <Link href="#">a link</Link> within a sentence.
      </Box>
      <Box>
        <Link href="#" weight="bold">
          Bold link
        </Link>
      </Box>
      <Box>
        <Link href="#" weight="bold" underline="none">
          Link without underline affordance
        </Link>
      </Box>
      <Box>
        And you can{" "}
        <Link color="gray" href="#">
          override
        </Link>{" "}
        the{" "}
        <Link color="sky" href="#">
          link color
        </Link>{" "}
        with{" "}
        <Link color="sky" href="#">
          Radix colors
        </Link>
        .
      </Box>
      <Box>
        We also have{" "}
        <Link href="#" color="dark" weight="bold">
          a custom dark/white color
        </Link>
        .
      </Box>

      <Box>
        Here&apos;s the Link without href where it{" "}
        <Link onClick={() => alert("Hello there")}>
          automatically adapts to a button
        </Link>{" "}
        while keeping the same style.
      </Box>
    </Flex>
  );
}
