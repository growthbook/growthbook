import { FeatureInterface } from "back-end/types/feature";

export default function DraftIndicator({
  feature,
}: {
  feature: FeatureInterface;
}) {
  const isDraft = feature.draft?.active;
  const color = isDraft ? "warning" : "info";
  const text = isDraft ? "DRAFT" : "PUBLISHED";

  return (
    <div className="d-flex align-items-center">
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: 10,
        }}
        className={`bg-${color} mr-2`}
      />
      <small className={`text-${color}`} style={{ fontWeight: "bold" }}>
        {text}
      </small>
    </div>
  );
}
