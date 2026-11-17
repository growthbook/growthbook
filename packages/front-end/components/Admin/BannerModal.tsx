import { useState } from "react";
import { Flex, TextArea } from "@radix-ui/themes";
import { OrganizationMessage } from "shared/types/organization";
import { useAuth } from "@/services/auth";
import Markdown from "@/components/Markdown/Markdown";
import { statusMap } from "@/components/OrganizationMessages/OrganizationMessages";
import Callout from "@/ui/Callout";
import RadioGroup from "@/ui/RadioGroup";
import Text from "@/ui/Text";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

export default function BannerModal({
  orgId,
  orgName,
  messages,
  index,
  close,
  onSave,
}: {
  orgId: string;
  orgName: string;
  messages: OrganizationMessage[];
  // null adds a new banner
  index: number | null;
  close: () => void;
  onSave: () => void;
}) {
  const { apiCall } = useAuth();
  const existing = index === null ? null : messages[index];
  const [level, setLevel] = useState<OrganizationMessage["level"]>(
    existing?.level ?? "info",
  );
  const [message, setMessage] = useState(existing?.message ?? "");

  return (
    <ModalStandard
      open
      trackingEventModalType=""
      header={existing ? "Edit Banner" : "Add Banner"}
      subheader={orgName}
      cta={existing ? "Save" : "Add banner"}
      ctaEnabled={!!message.trim()}
      close={close}
      submit={async () => {
        const banner = { level, message: message.trim() };
        await apiCall("/admin/organization", {
          method: "PUT",
          body: JSON.stringify({
            orgId,
            messages:
              index === null
                ? [...messages, banner]
                : messages.map((m, i) => (i === index ? banner : m)),
          }),
        });
        onSave();
      }}
    >
      <Flex direction="column" gap="4">
        <Flex direction="column" gap="2">
          <Text weight="semibold">Level</Text>
          <RadioGroup
            value={level}
            setValue={(v) => setLevel(v as OrganizationMessage["level"])}
            options={[
              { value: "info", label: "Info" },
              { value: "warning", label: "Warning" },
              { value: "danger", label: "Danger" },
            ]}
          />
        </Flex>
        <Flex direction="column" gap="2">
          <Text as="label" htmlFor="banner-message" weight="semibold">
            Message
          </Text>
          <TextArea
            id="banner-message"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Flex>
        {message.trim() && (
          <Flex direction="column" gap="2">
            <Text weight="semibold">Preview</Text>
            <Callout status={statusMap[level]}>
              <Markdown>{message}</Markdown>
            </Callout>
          </Flex>
        )}
      </Flex>
    </ModalStandard>
  );
}
