import { ReactNode } from "react";
import { AlertDialog, Box, Flex, Text } from "@radix-ui/themes";
import Button from "@/ui/Button";

type Props = {
  title: string;
  content?: ReactNode;
  yesText?: string;
  noText?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export default function ConfirmDialog({
  title,
  content,
  yesText = "Confirm",
  noText = "Cancel",
  onConfirm,
  onCancel,
}: Props) {
  return (
    <AlertDialog.Root open={true}>
      <AlertDialog.Content maxWidth="520px">
        <Flex direction="column" gap="4">
          <Box>
            <AlertDialog.Title>
              <Text as="div" weight="medium" size="4">
                {title}
              </Text>
            </AlertDialog.Title>
            <AlertDialog.Description>
              <Text as="div" size="2" color="gray">
                {content}
              </Text>
            </AlertDialog.Description>
          </Box>
          <Flex justify="end" gap="3">
            {noText ? (
              <Button variant="outline" color="gray" onClick={onCancel}>
                {noText}
              </Button>
            ) : null}
            <Button color="violet" onClick={onConfirm}>
              {yesText}
            </Button>
          </Flex>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
