export default function LegendSwatchButton({
  color,
  name,
  hidden,
  onClick,
  textColor,
}: {
  color: string | undefined;
  name: string;
  hidden: boolean;
  onClick: () => void;
  textColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!hidden}
      aria-label={hidden ? `Show ${name}` : `Hide ${name}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: 0,
        border: "none",
        background: "none",
        color: textColor,
        fontSize: 13,
        lineHeight: 1.2,
        cursor: "pointer",
        whiteSpace: "nowrap",
        opacity: hidden ? 0.45 : 1,
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 14,
          height: 14,
          borderRadius: 3,
          flexShrink: 0,
          background: hidden ? "var(--gray-a6)" : (color ?? "var(--gray-a8)"),
        }}
      />
      {name}
    </button>
  );
}
