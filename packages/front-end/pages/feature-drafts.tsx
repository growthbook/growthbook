import FeaturesDraftTable from "@/components/Features/FeaturesDraftTable";

export default function FeatureDraftsPage() {
  return (
    <div className="contents container pagecontents">
      <div className="row my-3">
        <div className="col">
          <h1>Feature Drafts</h1>
        </div>
      </div>
      <FeaturesDraftTable />
    </div>
  );
}
