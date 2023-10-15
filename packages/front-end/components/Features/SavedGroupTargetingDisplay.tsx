import { SavedGroupTargeting } from "back-end/types/feature";
import { useDefinitions } from "@/services/DefinitionsContext";

export interface Props {
  savedGroups?: SavedGroupTargeting[];
}

export default function SavedGroupTargetingDisplay({ savedGroups }: Props) {
  const { getSavedGroupById } = useDefinitions();

  return (
    <div>
      {savedGroups?.map((s, i) => (
        <div className="d-flex" key={i}>
          <div className="mr-1">{i ? "and" : "Users in"}</div>
          <div className="mr-1">{s.match} of:</div>
          <div>
            {s.ids.map((id) => (
              <span key={id} className="badge badge-secondary mr-1">
                {getSavedGroupById(id)?.groupName || id}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
