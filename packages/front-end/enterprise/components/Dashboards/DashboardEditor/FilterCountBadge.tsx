// A small, fixed-size count badge for filter pills. Single digits render as a
// circle (min-width equals height) and multi-digit counts grow into a rounded
// pill, so the badge width is stable and never renders as an oval.
export default function FilterCountBadge({ count }: { count: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 15,
        height: 15,
        padding: "0 4px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1,
        backgroundColor: "var(--gray-a4)",
        color: "var(--gray-11)",
      }}
    >
      {count}
    </span>
  );
}
