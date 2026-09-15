import { Flex } from "@radix-ui/themes";
import Metadata from "./Metadata";

export default function MetadataStories() {
  return (
    <Flex gap="3">
      <Metadata label="Small" value="Data" size="sm" />
      <Metadata label="Medium" value="Data" size="md" />
    </Flex>
  );
}
