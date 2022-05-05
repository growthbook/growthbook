import { FeatureInterface } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { ago, datetime } from "../../services/dates";

export interface Props {
  feature: FeatureInterface;
  revisions: FeatureRevisionInterface[];
  publish: () => void;
}

export default function RevisionTable({ feature, revisions, publish }: Props) {
  return (
    <div className="p-3 bg-white">
      <table className="table table-hover mb-0">
        <thead>
          <tr>
            <th>Version</th>
            <th>Comment</th>
            <th>Date Published</th>
          </tr>
        </thead>
        <tbody>
          {feature.draft?.active && (
            <tr>
              <td>
                <div className="d-flex">
                  <div className="mr-1">{(feature.revision || 1) + 1}</div>
                  <div>
                    <span className="badge badge-pill badge-warning">
                      draft
                    </span>
                  </div>
                </div>
              </td>
              <td>--</td>
              <td>
                <button
                  className="btn btn-sm btn-primary"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    publish();
                  }}
                >
                  Review Changes
                </button>
              </td>
            </tr>
          )}
          <tr>
            <td>
              <div className="d-flex">
                <div className="mr-1">{feature.revision || 1}</div>
                <div>
                  <span className="badge badge-pill badge-success">live</span>
                </div>
              </div>
            </td>
            <td>{feature.revisionComment || "--"}</td>
            <td title={datetime(feature.revisionDate || feature.dateCreated)}>
              {ago(feature.revisionDate || feature.dateCreated)}
            </td>
          </tr>
          {revisions
            .sort((a, b) => b.revision - a.revision)
            .slice(0, 10)
            .map((revision) => (
              <tr key={revision.revision}>
                <td>{revision.revision}</td>
                <td>{revision.comment || "--"}</td>
                <td title={datetime(revision.revisionDate)}>
                  {ago(revision.revisionDate)}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
