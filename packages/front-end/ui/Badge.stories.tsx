import { Flex } from "@radix-ui/themes";
import Badge from "./Badge";

export default function BadgeStories() {
  return (
    <Flex direction="column" gap="3">
      <Flex>
        <Badge label="Label" />
      </Flex>
      <Flex>
        <Badge color="indigo" label="Label" />
      </Flex>
      <Flex>
        <Badge color="cyan" label="Label" />
      </Flex>
      <Flex>
        <Badge color="orange" label="Label" />
      </Flex>
      <Flex>
        <Badge color="crimson" label="Label" />
      </Flex>
      <Flex>
        <Badge variant="solid" label="Label" />
      </Flex>
    </Flex>
  );
}
