import { FeatureInterface } from "back-end/types/feature";
import { FeatureRevisionSummary } from "back-end/types/feature-revision";
import { ago } from "shared/dates";
import SelectField from "../Forms/SelectField";

export interface Props {
  feature: FeatureInterface;
  revisions: FeatureRevisionSummary[];
  version: number;
  setVersion: (version: number) => void;
}

export default function RevisionDropdown({
  feature,
  revisions,
  version,
  setVersion,
}: Props) {
  const liveVersion = feature.version;

  if (!revisions.length) {
    revisions.push({
      baseVersion: 0,
      comment: "",
      createdBy: null,
      dateCreated: feature.dateCreated,
      datePublished: feature.dateCreated,
      dateUpdated: feature.dateUpdated,
      status: "published",
      version: 1,
    });
  }

  const versions = new Map(revisions.map((r) => [r.version + "", r]));

  const options = revisions.map((r) => ({
    value: r.version + "",
    label: r.version + "",
  }));
  options.sort((a, b) => parseInt(b.value) - parseInt(a.value));

  return (
    <SelectField
      options={options}
      value={version + ""}
      onChange={(version) => setVersion(parseInt(version))}
      sort={false}
      formatOptionLabel={({ value }) => {
        const revision = versions.get(value);

        const date =
          revision?.status === "published"
            ? revision?.datePublished
            : revision?.dateUpdated;

        return (
          <div>
            <div>
              <strong className="mr-2">Revision {value}</strong>
              {revision?.version === liveVersion ? (
                <span className="badge badge-success">published</span>
              ) : revision?.status === "draft" ? (
                <span className="badge badge-warning">draft</span>
              ) : (
                <span className="badge badge-secondary">old</span>
              )}
            </div>
            <div>
              {date && <small className="text-muted">{ago(date)}</small>}
            </div>
          </div>
        );
      }}
    />
  );
}
