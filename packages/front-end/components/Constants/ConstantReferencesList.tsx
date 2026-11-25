import { FC } from "react";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import ReferencesList, {
  ReferenceSection,
} from "@/components/References/ReferencesList";
import { ConstantReferences } from "@/hooks/useConstantReferences";

// Features, constants, and configs that reference a constant via `@const:key`.
export function constantReferenceSections(
  { features = [], constants = [] }: Partial<ConstantReferences>,
  i18n: I18n,
): ReferenceSection[] {
  return [
    {
      title: i18n._(msg`Feature Flags`),
      resourceType: "feature",
      items: features.map((f) => ({
        id: f.id,
        label: f.name ?? f.id,
        href: `/features/${f.id}`,
        projectIds: f.project ? [f.project] : undefined,
      })),
    },
    {
      title: i18n._(msg`Constants`),
      resourceType: "constant",
      items: constants
        .filter((c) => !c.isConfig)
        .map((c) => ({
          id: c.id,
          label: c.name || c.key,
          href: `/constants/${c.key}`,
          projectIds: c.project ? [c.project] : undefined,
        })),
    },
    {
      title: i18n._(msg`Configs`),
      resourceType: "constant",
      items: constants
        .filter((c) => c.isConfig)
        .map((c) => ({
          id: c.id,
          label: c.name || c.key,
          href: `/configs/${c.key}`,
          projectIds: c.project ? [c.project] : undefined,
        })),
    },
  ];
}

const ConstantReferencesList: FC<ConstantReferences> = (props) => {
  const { i18n } = useLingui();
  return <ReferencesList sections={constantReferenceSections(props, i18n)} />;
};

export default ConstantReferencesList;
