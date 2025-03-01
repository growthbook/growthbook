import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CloudUsage from "@/components/Settings/Usage/CloudUsage";

export default function UsagePage() {
  const permissionsUtil = usePermissionsUtil();

  if (!permissionsUtil.canViewUsage()) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      <CloudUsage />
    </div>
  );
}
