import { FeatureEnvironment } from "shared/types/feature";

export default function HoldoutEnvironments({
  environments,
  editEnvironments,
}: {
  environments: Record<string, FeatureEnvironment>;
  editEnvironments: () => void;
}) {
  return (
    <div className="box p-4 my-4">
      <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-2">
        <h4 className="m-0">Included Environments</h4>
        <div className="flex-1" />
        <button className="btn p-0 link-purple" onClick={editEnvironments}>
          Edit
        </button>
      </div>
      <div>
        {Object.keys(environments)
          .filter((e) => environments[e].enabled)
          .join(", ")}
      </div>
    </div>
  );
}
