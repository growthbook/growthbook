import { Flex } from "@radix-ui/themes";
import HelperText from "./HelperText";

export default function HelperTextStories() {
  return (
    <Flex direction="column" gap="3">
      <HelperText status="info">This is an info message</HelperText>
      <HelperText status="warning">This is a warning message</HelperText>
      <HelperText status="error">This is an error message</HelperText>
      <HelperText status="success">This is a success message</HelperText>
    </Flex>
  );
}
