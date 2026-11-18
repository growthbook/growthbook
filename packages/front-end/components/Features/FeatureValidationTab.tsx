import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Frame from "@/ui/Frame";
import JSONValidation from "@/components/Features/JSONValidation";
import CustomHooksSection from "@/components/CustomHooks/CustomHooksSection";

export default function FeatureValidationTab({
  feature,
  revision,
  mutate,
  setVersion,
  revisionList,
}: {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  mutate: () => void;
  setVersion?: (version: number) => void;
  revisionList?: MinimalFeatureRevisionInterface[];
}) {
  const permissionsUtil = usePermissionsUtil();
  return (
    <div className="contents container-fluid pagecontents">
      {/* JSON / simple schema validation (not applicable to boolean flags) */}
      {feature.valueType !== "boolean" && (
        <Frame mb="4" px="6" py="4">
          <JSONValidation
            feature={feature}
            mutate={mutate}
            setVersion={setVersion}
            revisionList={revisionList || []}
          />
        </Frame>
      )}

      <CustomHooksSection
        scope={{
          entityType: "feature",
          entityId: feature.id,
          label: "Feature",
        }}
        projects={[feature.project || ""]}
        description="Run sandboxed JavaScript validation before this Feature Flag is saved."
        canManage={permissionsUtil.canManageFeatureCustomHooks(feature)}
        modalProps={{ feature, revision }}
      />
    </div>
  );
}
