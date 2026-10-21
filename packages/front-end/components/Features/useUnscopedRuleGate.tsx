import { useState } from "react";
import { Box } from "@radix-ui/themes";
import { FeatureRuleScope, isUnscopedRule } from "shared/util";
import useOrgSettings from "@/hooks/useOrgSettings";
import ModalWarningBanner from "@/components/Modal/ModalWarningBanner";
import Checkbox from "@/ui/Checkbox";

// `previous`: every earlier copy of the rule the server may compare against.
export default function useUnscopedRuleGate(
  rule: FeatureRuleScope,
  previous: (FeatureRuleScope | undefined)[] = [],
) {
  const settings = useOrgSettings();
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
    unscopedRuleBlocksSubmit: gated && !acknowledged,
    unscopedRuleBanner: gated ? (
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
        projects.
      </ModalWarningBanner>
    ) : null,
  };
}
