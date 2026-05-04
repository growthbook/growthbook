import { Flex } from "@radix-ui/themes";
import Callout from "./Callout";

export default function CalloutStories() {
  return (
    <Flex direction="column" gap="3" mb="4">
      <Callout status="info">This is an informational callout.</Callout>
      <Callout status="warning">This is a warning callout.</Callout>
      <Callout status="error">This is an error callout.</Callout>
      <Callout status="success">This is a success callout.</Callout>
    </Flex>
  );
}
