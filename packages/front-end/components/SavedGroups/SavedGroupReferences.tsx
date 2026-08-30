import ReferencesLink from "@/components/References/ReferencesLink";

interface SavedGroupReferencesProps {
  totalReferences: number;
  onShowReferences: () => void;
  loading?: boolean;
}

export default function SavedGroupReferences({
  totalReferences,
  onShowReferences,
  loading,
}: SavedGroupReferencesProps) {
  return (
    <ReferencesLink
      total={totalReferences}
      onShow={onShowReferences}
      emptyTooltip="Currently, no active features, experiments, or saved groups reference this Saved Group."
      status={loading ? "loading" : undefined}
    />
  );
}
