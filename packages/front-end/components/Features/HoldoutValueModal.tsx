import { useMemo, useState } from "react";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { PiInfo } from "react-icons/pi";
import { Box, Text } from "@radix-ui/themes";
import { getReviewSetting } from "shared/util";
import { useAuth } from "@/services/auth";
import Callout from "@/ui/Callout";
import Modal from "@/components/Modal";
import Tooltip from "@/components/Tooltip/Tooltip";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import FeatureValueField from "./FeatureValueField";

interface Props {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  setVersion: (version: number) => void;
}

const HoldoutValueModal = ({
  feature,
  revisionList,
  close,
  mutate,
  setVersion,
}: Props) => {
  const { apiCall } = useAuth();
  const [holdoutValue, setHoldoutValue] = useState(
    feature.holdout?.value ?? "",
  );

  const settings = useOrgSettings();
  // Holdout changes are global-scope (like prerequisites/archived)
  const gatedEnvSet: Set<string> | "all" | "none" = useMemo(() => {
    const raw = settings?.requireReviews;
    if (raw === true) return "all";
    if (!Array.isArray(raw)) return "none";
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return "none";
    const envList = reviewSetting.environments ?? [];
    return envList.length === 0 ? "all" : new Set(envList);
  }, [settings?.requireReviews, feature]);

  const defaultDraft = useDefaultDraft(revisionList);
  const [mode, setMode] = useState<DraftMode>(
    defaultDraft != null ? "existing" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  if (!feature.holdout) {
    return null;
  }

  const holdout = feature.holdout;

  const handleSubmit = async () => {
    const isPublish = mode === "publish";
    const res = await apiCall<{
      feature: FeatureInterface;
      draftVersion?: number;
    }>(`/feature/${feature.id}`, {
      method: "PUT",
      body: JSON.stringify({
        holdout: {
          id: holdout.id,
          value: holdoutValue,
        },
        ...(isPublish
          ? { autoPublish: true }
          : mode === "existing" && selectedDraft != null
            ? { targetDraftVersion: selectedDraft }
            : { forceNewDraft: true }),
      }),
    });
    await mutate();
    const resolvedVersion =
      res.draftVersion ?? (mode === "existing" ? selectedDraft : null);
    if (resolvedVersion != null) setVersion(resolvedVersion);
    close();
  };

  return (
    <Modal
      header="Change Holdout Value"
      open={true}
      close={close}
      size="lg"
      trackingEventModalType="holdout-value-modal"
      submit={handleSubmit}
    >
      <DraftSelectorForChanges
        feature={feature}
        revisionList={revisionList}
        mode={mode}
        setMode={setMode}
        selectedDraft={selectedDraft}
        setSelectedDraft={setSelectedDraft}
        canAutoPublish={false}
        gatedEnvSet={gatedEnvSet}
      />
      <Box>
        <Callout status="warning" mb="4">
          <Text>
            If this feature has been implemented, units may be exposed to
            different feature values upon changing the holdout value.
          </Text>
        </Callout>
        <FeatureValueField
          label={
            <>
              Holdout Value{" "}
              <Tooltip
                body={
                  <>
                    Units that are held out for measurement in the holdout will
                    receive this value.
                  </>
                }
              >
                <PiInfo style={{ color: "var(--violet-11)" }} />
              </Tooltip>
            </>
          }
          id="holdoutValue"
          value={holdoutValue}
          setValue={setHoldoutValue}
          valueType={feature.valueType}
          useCodeInput={true}
          showFullscreenButton={true}
        />
      </Box>
    </Modal>
  );
};

export default HoldoutValueModal;
