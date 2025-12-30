import { FeatureInterface } from "shared/types/feature";
import { PiInfo } from "react-icons/pi";
import { useForm } from "react-hook-form";
import { Box, Text } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import Callout from "@/ui/Callout";
import Modal from "../Modal";
import Tooltip from "../Tooltip/Tooltip";
import FeatureValueField from "./FeatureValueField";

interface Props {
  feature: FeatureInterface;
  close: () => void;
  mutate: () => void;
}

const HoldoutValueModal = ({ feature, close, mutate }: Props) => {
  const { apiCall } = useAuth();
  const form = useForm<{ holdout: { id: string; value: string } }>({
    defaultValues: {
      holdout: feature.holdout,
    },
  });

  if (!feature.holdout) {
    return null;
  }

  const holdout = feature.holdout;

  return (
    <Modal
      header="Change Holdout Value"
      open={true}
      close={close}
      size="md"
      trackingEventModalType="holdout-value-modal"
      submit={form.handleSubmit(async (values) => {
        await apiCall<{ feature: FeatureInterface }>(`/feature/${feature.id}`, {
          method: "PUT",
          body: JSON.stringify({
            holdout: {
              id: holdout.id,
              value: values.holdout.value,
            },
          }),
        });
        mutate();
        close();
      })}
    >
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
          value={form.watch("holdout").value}
          setValue={(v) =>
            form.setValue("holdout", { ...form.watch("holdout"), value: v })
          }
          valueType={feature.valueType}
          useCodeInput={true}
          showFullscreenButton={true}
        />
      </Box>
    </Modal>
  );
};

export default HoldoutValueModal;
