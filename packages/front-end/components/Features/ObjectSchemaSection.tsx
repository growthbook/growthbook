import { useState } from "react";
import { FeatureInterface } from "shared/types/feature";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import EditObjectSchemaModal from "./EditObjectSchemaModal";

export default function ObjectSchemaSection({
  feature,
  mutate,
}: {
  feature: FeatureInterface;
  mutate: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  if (feature.valueType !== "object") return null;

  const fields = feature.objectSchema?.fields ?? [];

  return (
    <Box>
      {edit && (
        <EditObjectSchemaModal
          feature={feature}
          close={() => setEdit(false)}
          mutate={mutate}
        />
      )}
      <Flex align="center" gap="1" mb="1">
        <Heading as="h3" size="medium" mb="0">
          Object Schema
        </Heading>
        <div className="ml-auto">
          <Button variant="ghost" onClick={() => setEdit(true)}>
            Edit
          </Button>
        </div>
        <div>
          <Button variant="ghost" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <PiCaretRight /> : <PiCaretDown />}
          </Button>
        </div>
      </Flex>
      {!collapsed && (
        <Box pt="2">
          {fields.length === 0 ? (
            <Text color="text-mid" size="medium">
              No schema defined. Click Edit to add fields.
            </Text>
          ) : (
            <Flex direction="column" gap="1">
              {fields.map((f) => (
                <Flex key={f.key} gap="2" align="baseline">
                  <Text weight="medium">{f.key}</Text>
                  <Text size="small" color="text-mid">
                    {f.type}
                    {!f.required ? " (optional)" : ""}
                  </Text>
                </Flex>
              ))}
            </Flex>
          )}
        </Box>
      )}
    </Box>
  );
}
