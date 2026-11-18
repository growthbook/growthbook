import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiArrowSquareOutFill } from "react-icons/pi";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import Link from "@/ui/Link";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";

// Callers with extra save behavior (Feature's draft, publish, and conflict
// handling) should keep their own modal.
export default function EditDescriptionModal({
  initialValue,
  placeholder,
  save,
  close,
  trackingEventModalSource,
  trackingEventModalType,
}: {
  initialValue: string;
  placeholder?: string;
  save: (description: string) => Promise<void>;
  close: () => void;
  trackingEventModalSource?: string;
  trackingEventModalType: string;
}) {
  const [description, setDescription] = useState(initialValue);

  return (
    <ModalStandard
      trackingEventModalSource={trackingEventModalSource}
      trackingEventModalType={trackingEventModalType}
      header="Edit Description"
      subheader={
        <>
          <Text size="inherit" mr="1">
            Use markdown to format your content.
          </Text>
          <Link
            external
            weight="bold"
            href="https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax"
          >
            <Flex align="center" gap="1" display="inline-flex">
              Learn more
              <PiArrowSquareOutFill />
            </Flex>
          </Link>
        </>
      }
      open={true}
      size="lg"
      close={close}
      submit={async () => {
        await save(description.trim());
      }}
    >
      <MarkdownInput
        value={description}
        setValue={setDescription}
        placeholder={placeholder}
        showButtons={false}
      />
    </ModalStandard>
  );
}
