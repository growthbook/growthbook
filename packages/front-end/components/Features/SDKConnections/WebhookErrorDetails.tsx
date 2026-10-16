import { Flex } from "@radix-ui/themes";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import styles from "@/components/Confirmations/RequestDetails.module.scss";
import { describeWebhookError } from "./webhookErrors";

export default function WebhookErrorDetails({
  name,
  error,
}: {
  name?: string;
  error: string;
}) {
  const { message, body } = describeWebhookError(error);
  return (
    <Flex direction="column" gap="1">
      {name ? <Text weight="semibold">{name}</Text> : null}
      <HelperText status="error">{message}</HelperText>
      {body ? (
        <pre className={styles.json} style={{ margin: 0, maxHeight: 200 }}>
          {body}
        </pre>
      ) : null}
    </Flex>
  );
}
