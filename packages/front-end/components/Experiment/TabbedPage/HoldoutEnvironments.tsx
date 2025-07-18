export default function HoldoutEnvironments({
  environments,
  editEnvironments,
}: {
  environments: string[];
  editEnvironments: () => void;
}) {
  return (
    <div className="box p-4 my-4">
      <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-4">
        <h4 className="m-0">Included Environments</h4>
        <div className="flex-1" />
        <button className="btn p-0 link-purple" onClick={editEnvironments}>
          Edit
        </button>
      </div>
      <div>{environments.join(", ")}</div>
    </div>
  );
}
