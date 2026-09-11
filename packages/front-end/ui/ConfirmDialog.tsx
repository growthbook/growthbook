import { ReactNode, useState } from "react";
import { AlertDialog, Box, Flex, Text } from "@radix-ui/themes";
import Button, { Color } from "@/ui/Button";
import HelperText from "@/ui/HelperText";

type Props = {
  title: string;
  content?: ReactNode;
  yesText?: string;
  noText?: string;
  /** Match the control that opened the dialog, so a destructive step stays red. */
  color?: Color;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export default function ConfirmDialog({
  title,
  content,
  yesText = "Confirm",
  noText = "Cancel",
  color = "violet",
  onConfirm,
  onCancel,
}: Props) {
  const [error, setError] = useState<string | null>(null);
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
          {error && <HelperText status="error">{error}</HelperText>}
          <Flex justify="end" gap="3">
            {noText ? (
              <Button variant="outline" color="gray" onClick={onCancel}>
                {noText}
              </Button>
            ) : null}
            <Button color={color} onClick={onConfirm} setError={setError}>
              {yesText}
            </Button>
          </Flex>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
