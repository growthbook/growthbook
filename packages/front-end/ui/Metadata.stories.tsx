import { Flex } from "@radix-ui/themes";
import Metadata from "./Metadata";

export default function MetadataStories() {
  return (
    <Flex gap="3">
      <Metadata label="Title" value="Data" />
      <Metadata label="Title1" value="Data1" />
    </Flex>
  );
}
