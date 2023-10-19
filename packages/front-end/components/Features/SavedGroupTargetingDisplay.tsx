import { SavedGroupTargeting } from "back-end/types/feature";
import { useDefinitions } from "@/services/DefinitionsContext";

export interface Props {
  savedGroups?: SavedGroupTargeting[];
  initialPrefix?: string;
  groupClassName?: string;
}

export default function SavedGroupTargetingDisplay({
  savedGroups,
  initialPrefix = "Users",
  groupClassName = "",
}: Props) {
  const { getSavedGroupById } = useDefinitions();

  return (
    <>
      {savedGroups?.map((s, i) => {
        const prefix = i ? "AND" : initialPrefix;

        let description = "in";

        if (s.match === "any") {
          if (s.ids.length > 1) description = "in any of";
        } else if (s.match === "all") {
          if (s.ids.length > 1) description = "in all of";
        } else if (s.match === "none") {
          description = "not in";
        }

        return (
          <div className={"d-flex " + groupClassName} key={"savedGroup-" + i}>
            <div className="mr-1">{prefix}</div>
            <div className="mr-1">{description}</div>
            <div>
              {s.ids.length > 1 && "( "}
              {s.ids.map((id) => (
                <span key={id} className={`border px-2 bg-light rounded mr-1`}>
                  {getSavedGroupById(id)?.groupName || id}
                </span>
              ))}
              {s.ids.length > 1 && ")"}
            </div>
          </div>
        );
      })}
    </>
  );
}
