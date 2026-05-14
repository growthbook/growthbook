import { useMemo, useState } from "react";
import { FeatureInterface } from "shared/types/feature";
import { simpleToJSONSchema } from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Code from "@/components/SyntaxHighlighting/Code";
import JSONSchemaDescription from "@/components/Features/JSONSchemaDescription";
import EditObjectSchemaModal from "./EditObjectSchemaModal";

export default function ObjectSchemaSection({
  feature,
  mutate,
}: {
  feature: FeatureInterface;
  mutate: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  // Convert the SimpleSchema to a JSON Schema once so we can drive both the
  // inline summary (JSONSchemaDescription) and the expanded raw-code view
  // through the same display path as the JSON Validation section.
  const jsonSchema = useMemo(() => {
    if (!feature.objectSchema) return null;
    try {
      return JSON.parse(simpleToJSONSchema(feature.objectSchema));
    } catch {
      return null;
    }
  }, [feature.objectSchema]);

  if (feature.valueType !== "object") return null;

  const hasFields = !!feature.objectSchema?.fields?.length;

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
      {hasFields && jsonSchema && (
        <Flex pt="2" align="center">
          <JSONSchemaDescription jsonSchema={jsonSchema} />
        </Flex>
      )}
      {!collapsed && (
        <Box pt="4">
          {hasFields && jsonSchema ? (
            <Code
              language="json"
              filename="Object Schema"
              code={JSON.stringify(jsonSchema, null, 2)}
              maxHeight="300px"
            />
          ) : (
            <em className="text-muted">
              No schema defined. Click Edit to add fields.
            </em>
          )}
        </Box>
      )}
    </Box>
  );
}
