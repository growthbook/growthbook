import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Markdown from "@/components/Markdown/Markdown";
import { GBEdit } from "@/components/Icons";
import EditDescriptionModal from "@/components/Markdown/EditDescriptionModal";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

export default function DataSourceDescriptionSection({
  description,
  canEdit,
  save,
}: {
  description: string;
  canEdit: boolean;
  save: (description: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (!description && !canEdit) return null;

  return (
    <Box mt="4">
      {editing ? (
        <EditDescriptionModal
          initialValue={description}
          placeholder="Add a description to keep your team informed about this Data Source."
          save={save}
          close={() => setEditing(false)}
          trackingEventModalSource="datasource-settings"
          trackingEventModalType="edit-datasource-description-modal"
        />
      ) : null}
      <Flex align="center" gap="2" mb="2">
        <Text size="md" weight="semibold">
          Description
        </Text>
        {canEdit ? (
          <Link
            aria-label={description ? "Edit description" : "Add description"}
            onClick={() => setEditing(true)}
          >
            <GBEdit />
          </Link>
        ) : null}
      </Flex>
      {description ? (
        <Box style={{ maxHeight: 320, overflowY: "auto" }}>
          <Markdown>{description}</Markdown>
        </Box>
      ) : (
        <Text as="p" size="sm" color="text-mid" mb="0">
          Add a description to keep your team informed about this Data Source.
        </Text>
      )}
    </Box>
  );
}
