import ReferencesLink from "@/components/References/ReferencesLink";

interface SavedGroupReferencesProps {
  totalReferences: number;
  onShowReferences: () => void;
}

export default function SavedGroupReferences({
  totalReferences,
  onShowReferences,
}: SavedGroupReferencesProps) {
  return (
    <ReferencesLink
      total={totalReferences}
      onShow={onShowReferences}
      emptyTooltip="Currently, no active features, experiments, or saved groups reference this Saved Group."
    />
  );
}
