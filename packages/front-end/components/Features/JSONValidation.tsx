import { FeatureInterface } from "back-end/types/feature";
import { getValidation } from "shared/util";
import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import { ago, datetime } from "shared/dates";
import { useRouter } from "next/router";
import { useUser } from "@/services/UserContext";
import Button from "@/ui/Button";
import JSONSchemaDescription from "@/components/Features/JSONSchemaDescription";
import Code from "@/components/SyntaxHighlighting/Code";
import EditSchemaModal from "@/components/Features/EditSchemaModal";
import UpgradeModal from "@/components/Settings/UpgradeModal";

export interface Props {
  feature: FeatureInterface;
  mutate: () => void;
}

export default function JSONValidation({ feature, mutate }: Props) {
  const { hasCommercialFeature } = useUser();

  const router = useRouter();
  const isNew = router?.query && "new" in router.query;

  const [upgradeModal, setUpgradeModal] = useState(false);

  const { jsonSchema, validationEnabled, schemaDateUpdated } =
    getValidation(feature);

  const hasJsonValidator = hasCommercialFeature("json-validation");

  const [collapsed, setCollapsed] = useState(
    (hasJsonValidator && validationEnabled) || !isNew,
  );

  const [edit, setEdit] = useState(false);

  if (feature.valueType !== "json") return null;

  return (
    <Box>
      {edit && (
        <EditSchemaModal
          close={() => setEdit(false)}
          feature={feature}
          mutate={mutate}
          defaultEnable={!validationEnabled}
          onEnable={() => {
            if (!validationEnabled) {
              setCollapsed(true);
            }
          }}
        />
      )}
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="json-validation"
          commercialFeature="json-validation"
        />
      )}
      <Flex align="center">
        <h3 className="mb-0">
          {hasJsonValidator && validationEnabled
            ? "Validation Enabled"
            : "Validation Not Enabled"}
        </h3>
        <div className="ml-auto">
          {!hasJsonValidator ? (
            <Button variant="ghost" onClick={() => setUpgradeModal(true)}>
              Upgrade
            </Button>
          ) : !validationEnabled ? (
            <Button variant="ghost" onClick={() => setEdit(true)}>
              Enable
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setEdit(true)}>
              Edit
            </Button>
          )}
        </div>
        <div>
          <Button variant="ghost" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <PiCaretRight /> : <PiCaretDown />}
          </Button>
        </div>
      </Flex>
      {validationEnabled && (
        <Flex pt="2" align="center">
          <JSONSchemaDescription jsonSchema={jsonSchema} />
        </Flex>
      )}
      {!collapsed && (
        <Box pt="4">
          {!hasJsonValidator || !validationEnabled ? (
            <img
              src="/images/empty-states/json_validation.png"
              alt="JSON Validation"
              style={{ width: "100%", height: "auto" }}
            />
          ) : (
            <div>
              {schemaDateUpdated && (
                <div className="text-muted" title={datetime(schemaDateUpdated)}>
                  Updated {schemaDateUpdated ? ago(schemaDateUpdated) : ""}
                </div>
              )}
              <Code
                language="json"
                filename={"JSON Schema"}
                code={JSON.stringify(jsonSchema, null, 2)}
                maxHeight="300px"
              />
            </div>
          )}
        </Box>
      )}
    </Box>
  );
}
