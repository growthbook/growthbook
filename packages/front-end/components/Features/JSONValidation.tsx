import { FeatureInterface } from "shared/types/feature";
import { getValidation, getReviewSetting } from "shared/util";
import { useMemo, useState } from "react";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import { ago, datetime } from "shared/dates";
import { useRouter } from "next/router";
import DraftControlBadge from "@/components/Features/DraftControlBadge";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Badge from "@/ui/Badge";
import JSONSchemaDescription from "@/components/Features/JSONSchemaDescription";
import Code from "@/components/SyntaxHighlighting/Code";
import EditSchemaModal from "@/components/Features/EditSchemaModal";
import UpgradeModal from "@/components/Settings/UpgradeModal";

export interface Props {
  feature: FeatureInterface;
  mutate: () => void;
  setVersion?: (version: number) => void;
  revisionList?: MinimalFeatureRevisionInterface[];
}

export default function JSONValidation({
  feature,
  mutate,
  setVersion,
  revisionList,
}: Props) {
  const { hasCommercialFeature } = useUser();
  const settings = useOrgSettings();

  const requiresApproval = useMemo(() => {
    const requireReviewSettings = settings?.requireReviews;
    if (!requireReviewSettings || typeof requireReviewSettings === "boolean") {
      return !!requireReviewSettings;
    }
    const reviewSetting = getReviewSetting(requireReviewSettings, feature);
    return !!reviewSetting?.requireReviewOn;
  }, [settings?.requireReviews, feature]);

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
          setVersion={setVersion}
          revisionList={revisionList}
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
      <Flex align="center" gap="1" mb="1">
        <Heading as="h3" size="medium" mb="0">
          JSON Validation
        </Heading>
        <DraftControlBadge
          gated={requiresApproval}
          approvalsEnabled={requiresApproval}
        />
        {hasJsonValidator && (
          <Badge
            label={validationEnabled ? "Enabled" : "Not enabled"}
            color={validationEnabled ? "green" : "gray"}
            variant="soft"
          />
        )}
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
      {!validationEnabled && (
        <em className="text-muted">
          Prevent typos and mistakes by specifying validation rules using JSON
          Schema or our Simple Validation Builder
        </em>
      )}
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
