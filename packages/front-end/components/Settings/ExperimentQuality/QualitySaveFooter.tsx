import { ReactNode, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiWarningCircle } from "react-icons/pi";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import TempMessage from "@/components/TempMessage";
import styles from "./ExperimentQuality.module.scss";

export default function QualitySaveFooter({
  impact,
  scopeImpact,
  dirty,
  blocked,
  aiChanged,
  canRecheck,
  save,
  cancel,
}: {
  // What saving re-scores, as a sentence
  impact: ReactNode;
  // Which experiments a re-check covers, for its confirmation
  scopeImpact: ReactNode;
  dirty: boolean;
  // Why it can't save yet
  blocked: string;
  // The AI checks changed, so offer to re-check existing verdicts
  aiChanged: boolean;
  canRecheck: boolean;
  save: (options?: { recheck?: boolean }) => Promise<void>;
  cancel: () => void;
}) {
  const [confirmRecheck, setConfirmRecheck] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const submit = async (recheck = false) => {
    await save({ recheck });
    setSaved(true);
  };

  return (
    <>
      {confirmRecheck ? (
        <ModalStandard
          open
          trackingEventModalType="experiment-quality-recheck"
          header="Re-check Existing Experiments?"
          cta="Save and re-check"
          close={() => setConfirmRecheck(false)}
          submit={() => submit(true)}
          secondaryAction={
            <Button
              variant="outline"
              onClick={async () => {
                await submit(false);
                setConfirmRecheck(false);
              }}
            >
              Save only
            </Button>
          }
        >
          <Text as="p">
            You changed AI checks. New verdicts will use the new settings.
            Existing experiments keep their current AI verdicts unless you
            re-check them.
          </Text>
          <Text as="p" mb="0" color="text-mid">
            {scopeImpact} · Each re-check uses AI.
          </Text>
        </ModalStandard>
      ) : null}
      <Flex className={styles.footer} align="center" justify="between" gap="4">
        <Flex align="center" gap="2">
          {dirty ? (
            <>
              <PiWarningCircle color="var(--amber-11)" />
              <Text color="text-mid">{impact}</Text>
            </>
          ) : null}
        </Flex>
        <Flex align="center" gap="3">
          {error ? <HelperText status="error">{error}</HelperText> : null}
          {dirty && blocked ? (
            <HelperText status="error">{blocked}</HelperText>
          ) : null}
          {saved ? (
            <TempMessage size="sm" close={() => setSaved(false)}>
              Settings saved
            </TempMessage>
          ) : null}
          <Button
            variant="outline"
            disabled={!dirty}
            onClick={() => {
              setError("");
              cancel();
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={!dirty || !!blocked}
            setError={(e) => setError(e ?? "")}
            onClick={async () => {
              setError("");
              if (aiChanged && canRecheck) {
                setConfirmRecheck(true);
              } else {
                await submit(false);
              }
            }}
          >
            Save
          </Button>
        </Flex>
      </Flex>
    </>
  );
}
