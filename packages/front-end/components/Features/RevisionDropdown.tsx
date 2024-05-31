import { FeatureInterface } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { ago } from "shared/dates";
import SelectField from "@/components/Forms/SelectField";
import AuditUser from "@/components/Avatar/AuditUser";

export interface Props {
  feature: FeatureInterface;
  revisions: FeatureRevisionInterface[];
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

  const allRevisions = [...revisions];

  const versions = new Map(allRevisions.map((r) => [r.version + "", r]));

  const options = allRevisions
    .filter((r) => r.status !== "discarded" || r.version === version)
    .map((r) => ({
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
      formatOptionLabel={({ value }, { context }) => {
        const revision = versions.get(value);

        const date =
          revision?.status === "published"
            ? revision?.datePublished
            : revision?.dateUpdated;

        return (
          <div className="d-flex w-100">
            <div className="mr-3">
              <strong className="mr-2">Revision {value}</strong>
              {revision?.version === liveVersion ? (
                <span className="badge badge-success">live</span>
              ) : revision?.status === "draft" ? (
                <span className="badge badge-warning">draft</span>
              ) : revision?.status === "published" ? (
                <span className="badge badge-light border">locked</span>
              ) : revision?.status === "discarded" ? (
                <span
                  className="badge badge-secondary border"
                  style={{ opacity: 0.6 }}
                >
                  discarded
                </span>
              ) : null}
              {context !== "value" && (
                <div style={{ marginTop: -4 }}>
                  {date && <small className="text-muted">{ago(date)}</small>}
                </div>
              )}
            </div>
            {context !== "value" && (
              <div className="ml-auto">
                <AuditUser user={revision?.createdBy} />
              </div>
            )}
          </div>
        );
      }}
    />
  );
}
