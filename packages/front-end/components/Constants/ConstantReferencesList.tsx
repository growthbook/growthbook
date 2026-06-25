import { FC } from "react";
import ReferencesList, {
  ReferenceSection,
} from "@/components/References/ReferencesList";
import { ConstantReferences } from "@/hooks/useConstantReferences";

// Features and constants that reference a constant via `@const:key`.
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
      title: "Constants & Configs",
      resourceType: "constant",
      items: constants.map((c) => ({
        id: c.id,
        label: c.name || c.key,
        href: c.isConfig ? `/configs/${c.key}` : `/constants/${c.key}`,
        projectIds: c.project ? [c.project] : undefined,
      })),
    },
  ];

  return <ReferencesList sections={sections} />;
};

export default ConstantReferencesList;
