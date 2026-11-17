import { Flex } from "@radix-ui/themes";
import FileInput from "./FileInput";

export default function FileInputStories() {
  return (
    <Flex direction="column" gap="3" maxWidth="360px">
      <FileInput name="example" onChange={() => {}} />
      <FileInput
        name="required"
        required
        placeholder="Upload key file..."
        onChange={() => {}}
      />
    </Flex>
  );
}
