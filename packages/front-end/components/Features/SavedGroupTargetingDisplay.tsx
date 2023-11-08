import { SavedGroupTargeting } from "back-end/types/feature";
import Link from "next/link";
import { useDefinitions } from "@/services/DefinitionsContext";

export interface Props {
  savedGroups?: SavedGroupTargeting[];
  initialAnd?: boolean;
  groupClassName?: string;
}

function getDescription({ match, ids }: SavedGroupTargeting): string {
  switch (match) {
    case "any":
      return ids.length > 1 ? "in any of the groups" : "in group";
    case "all":
      return ids.length > 1 ? "in all of the groups" : "in group";
    case "none":
      return ids.length > 1 ? "in none of the groups" : "not in group";
  }
}

export default function SavedGroupTargetingDisplay({
  savedGroups,
  initialAnd = false,
  groupClassName = "",
}: Props) {
  const { getSavedGroupById } = useDefinitions();

  return (
    <>
      {savedGroups?.map((s, i) => {
        return (
          <div className={"d-flex " + groupClassName} key={"savedGroup-" + i}>
            {i || initialAnd ? <div className="mr-1">AND</div> : null}
            <div className="mr-1">{getDescription(s)}</div>
            <div>
              {s.ids.length > 1 && "( "}
              {s.ids.map((id) => (
                <Link href="/saved-groups" key={id}>
                  <a
                    className={`border px-2 bg-light rounded mr-1`}
                    title="Manage Saved Groups"
                  >
                    {getSavedGroupById(id)?.groupName || id}
                  </a>
                </Link>
              ))}
              {s.ids.length > 1 && ")"}
            </div>
          </div>
        );
      })}
    </>
  );
}
