import { FC } from "react";
import ReferencesList, {
  ReferenceSection,
} from "@/components/References/ReferencesList";

type FeatureRef = { id: string; name?: string; project?: string };
type ExperimentRef = {
  id: string;
  name?: string;
  project?: string;
  projects?: string[];
};
type SavedGroupRef = { id: string; groupName?: string; projects?: string[] };

interface SavedGroupReferencesListProps {
  features?: FeatureRef[];
  experiments?: ExperimentRef[];
  savedGroups?: SavedGroupRef[];
}

const SavedGroupReferencesList: FC<SavedGroupReferencesListProps> = ({
  features = [],
  experiments = [],
  savedGroups = [],
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
      title: "Experiments",
      resourceType: "experiment",
      items: experiments.map((e) => ({
        id: e.id,
        label: e.name ?? e.id,
        href: `/experiment/${e.id}`,
        projectIds: e.project
          ? [e.project]
          : e.projects?.length
            ? e.projects
            : undefined,
      })),
    },
    {
      title: "Saved Groups",
      resourceType: "saved group",
      items: savedGroups.map((sg) => ({
        id: sg.id,
        label: sg.groupName ?? sg.id,
        href: `/saved-groups/${sg.id}`,
        projectIds: sg.projects?.length ? sg.projects : undefined,
      })),
    },
  ];

  return <ReferencesList sections={sections} />;
};

export default SavedGroupReferencesList;
