import { SavedGroupTargeting } from "back-end/types/feature";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "../Forms/SelectField";
import MultiSelectField from "../Forms/MultiSelectField";
import { GBAddCircle } from "../Icons";

export interface Props {
  value: SavedGroupTargeting[];
  setValue: (savedGroups: SavedGroupTargeting[]) => void;
}

export default function SavedGroupTargetingField({ value, setValue }: Props) {
  const { savedGroups, getSavedGroupById } = useDefinitions();

  if (!savedGroups.length) return null;

  const options = savedGroups.map((s) => ({
    value: s.id,
    label: s.groupName,
  }));

  const conflicts = getSavedGroupTargetingConflicts(value);

  return (
    <div className="form-group">
      <label>Target by Saved Group</label>
      <div className="border bg-light p-3 mb-1">
        {value.length > 0 ? (
          <div>
            {conflicts.length > 0 && (
              <div className="alert alert-danger">
                <strong>Error:</strong> You have a conflict in your rules with
                the following groups:{" "}
                {conflicts.map((c) => (
                  <span key={c} className="badge badge-danger mr-1">
                    {getSavedGroupById(c)?.groupName || c}
                  </span>
                ))}
              </div>
            )}
            {value.map((v, i) => {
              return (
                <div className="row align-items-center mb-3" key={i}>
                  <div className="col-auto" style={{ width: 70 }}>
                    {i === 0 ? "In" : "AND"}
                  </div>
                  <div className="col-auto">
                    <SelectField
                      value={v.match}
                      onChange={(match) => {
                        const newValue = [...value];
                        newValue[i] = { ...v };
                        newValue[i].match = match as "all" | "any" | "none";
                        setValue(newValue);
                      }}
                      sort={false}
                      options={[
                        {
                          value: "any",
                          label: "Any of",
                        },
                        {
                          value: "all",
                          label: "All of",
                        },
                        {
                          value: "none",
                          label: "None of",
                        },
                      ]}
                    />
                  </div>
                  <div className="col">
                    <MultiSelectField
                      value={v.ids}
                      onChange={(ids) => {
                        const newValue = [...value];
                        newValue[i] = { ...v };
                        newValue[i].ids = ids;
                        setValue(newValue);
                      }}
                      options={options}
                      required
                      placeholder="Select groups..."
                      closeMenuOnSelect={true}
                      formatOptionLabel={({ value, label }) => {
                        const group = getSavedGroupById(value);
                        return (
                          <>
                            {label}
                            {group?.type === "list" && group?.values && (
                              <span className="badge ml-1 border bg-light text-dark">
                                {group.values.length}
                              </span>
                            )}
                          </>
                        );
                      }}
                    />
                  </div>
                  <div className="col-auto ml-auto">
                    <button
                      className="btn btn-link text-danger"
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        const newValue = [...value];
                        newValue.splice(i, 1);
                        setValue(newValue);
                      }}
                    >
                      remove
                    </button>
                  </div>
                </div>
              );
            })}
            <a
              href="#"
              className="btn btn-outline-primary"
              onClick={(e) => {
                e.preventDefault();
                setValue([
                  ...value,
                  {
                    match: "any",
                    ids: [],
                  },
                ]);
              }}
            >
              <span className="pr-2">
                <GBAddCircle />
              </span>
              Add another condition
            </a>
          </div>
        ) : (
          <div>
            <em className="text-muted mr-3">
              No saved group targeting applied.
            </em>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setValue([
                  ...value,
                  {
                    match: "any",
                    ids: [],
                  },
                ]);
              }}
            >
              Add group targeting
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export function getSavedGroupTargetingConflicts(
  savedGroups: SavedGroupTargeting[]
): string[] {
  const required = new Set<string>();
  const excluded = new Set<string>();
  savedGroups.forEach((rule) => {
    if (rule.match === "all" || rule.match === "any") {
      rule.ids.forEach((id) => required.add(id));
    } else if (rule.match === "none") {
      rule.ids.forEach((id) => excluded.add(id));
    }
  });

  // If there's an overlap between required and excluded groups, there's a conflict
  return Array.from(required).filter((id) => excluded.has(id));
}

export function validateSavedGroupTargeting(
  savedGroups?: SavedGroupTargeting[]
) {
  if (!savedGroups) return;

  if (savedGroups.some((g) => g.ids.length === 0)) {
    throw new Error("Cannot have empty Saved Group targeting rules.");
  }

  if (getSavedGroupTargetingConflicts(savedGroups).length > 0) {
    throw new Error(
      "Please fix conflicts in your Saved Group rules before saving"
    );
  }
}
