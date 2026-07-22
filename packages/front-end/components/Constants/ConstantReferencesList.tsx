import { FC } from "react";
import ReferencesList, {
  ReferenceSection,
} from "@/components/References/ReferencesList";
import { ConstantReferences } from "@/hooks/useConstantReferences";

// Features, constants, and configs that reference a constant via `@const:key`.
const ConstantReferencesList: FC<ConstantReferences> = ({
  features = [],
  constants = [],
}) => {
  const sections: ReferenceSection[] = [
    {
      title: "Features",
      resourceType: "feature",
      items: features.map((f) => ({
        id: f.id,
        label: f.name ?? f.id,
        href: `/features/${f.id}`,
        projectIds: f.project ? [f.project] : undefined,
      })),
    },
    {
      title: "Constants",
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
      title: "Configs",
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

  return <ReferencesList sections={sections} />;
};

export default ConstantReferencesList;
