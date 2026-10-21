import { useState } from "react";
import { Box } from "@radix-ui/themes";
import { FeatureRuleScope, isUnscopedRule } from "shared/util";
import useOrgSettings from "@/hooks/useOrgSettings";
import ModalWarningBanner from "@/components/Modal/ModalWarningBanner";
import Checkbox from "@/ui/Checkbox";
import { StopSubmit } from "@/ui/Modal/StopSubmit";

// `previous`: every earlier copy of the rule the server may compare against.
// The banner appears once a save is stopped, then gates Save until acknowledged.
export default function useUnscopedRuleGate(
  rule: FeatureRuleScope,
  previous: (FeatureRuleScope | undefined)[] = [],
) {
  const settings = useOrgSettings();
  const [stopped, setStopped] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const alreadyUnscoped =
    previous.length > 0 &&
    previous.every((before) => !!before && isUnscopedRule(before));
  const gated =
    !!settings.requireScopedFeatureRules &&
    isUnscopedRule(rule) &&
    !alreadyUnscoped;

  return {
    allowUnscopedRules: gated && acknowledged,
    unscopedRuleBlocksSubmit: gated && stopped && !acknowledged,
    // Call in submit before any request.
    checkUnscopedRule: () => {
      if (gated && !acknowledged) {
        setStopped(true);
        throw new StopSubmit();
      }
    },
    unscopedRuleBanner:
      gated && stopped ? (
        <ModalWarningBanner
          controls={
            <Box style={{ color: "var(--violet-11)" }}>
              <Checkbox
                value={acknowledged}
                setValue={setAcknowledged}
                label="Acknowledge"
                weight="medium"
                align="center"
              />
            </Box>
          }
        >
          Your organization requires rules to target specific environments or
          Projects.
        </ModalWarningBanner>
      ) : null,
  };
}
