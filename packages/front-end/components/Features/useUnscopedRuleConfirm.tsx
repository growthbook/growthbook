import { useState } from "react";
import { isUnscopedRule } from "shared/util";
import useOrgSettings from "@/hooks/useOrgSettings";
import ConfirmDialog from "@/ui/ConfirmDialog";

type RuleScope = Parameters<typeof isUnscopedRule>[0];

// True means the save needs `allowUnscopedRules`. Going back throws an empty
// error, which keeps the modal open without a message.
export default function useUnscopedRuleConfirm() {
  const settings = useOrgSettings();
  const [resolve, setResolve] = useState<((confirmed: boolean) => void) | null>(
    null,
  );

  // `previous`: every earlier copy of the rule the server may compare against.
  const confirmUnscopedRule = async (
    rule: RuleScope,
    previous: (RuleScope | undefined)[] = [],
  ): Promise<boolean> => {
    const alreadyUnscoped =
      previous.length > 0 &&
      previous.every((before) => !!before && isUnscopedRule(before));
    if (
      !settings.requireScopedFeatureRules ||
      !isUnscopedRule(rule) ||
      alreadyUnscoped
    ) {
      return false;
    }
    const confirmed = await new Promise<boolean>((r) => setResolve(() => r));
    if (!confirmed) throw new Error("");
    return true;
  };

  const close = (confirmed: boolean) => {
    resolve?.(confirmed);
    setResolve(null);
  };

  const unscopedRuleDialog = resolve ? (
    <ConfirmDialog
      title="Save for all environments and projects?"
      content="Rules should target specific environments or projects."
      yesText="Save anyway"
      noText="Go back"
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ) : null;

  return { confirmUnscopedRule, unscopedRuleDialog };
}
