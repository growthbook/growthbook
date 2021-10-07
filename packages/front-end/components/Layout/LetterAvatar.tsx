import md5 from "md5";

const colors = [
  "#ffed6f",
  "#8dd3c7",
  "#ffffb3",
  "#b3de69",
  "#fccde5",
  "#bc80bd",
  "#fb8072",
  "#80b1d3",
  "#fdb462",
  "#ccebc5",
];

function getTextColor(bg: string): string {
  const red = parseInt(bg.slice(1, 3), 16);
  const green = parseInt(bg.slice(3, 5), 16);
  const blue = parseInt(bg.slice(5), 16);

  if (red * 0.299 + green * 0.587 + blue * 0.114 > 186) {
    return "#000000";
  } else {
    return "#ffffff";
  }
}

export default function LetterAvatar({
  name,
  defaultInitials = "",
}: {
  name: string;
  defaultInitials?: string;
}) {
  const initials = name
    ? name
        .toUpperCase()
        .replace(/[^A-Z ]/g, "")
        .split(" ")
        .map((word) => word[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
    : defaultInitials;

  const bg = name
    ? colors[parseInt(md5(name).slice(0, 3), 16) % colors.length]
    : "#703fc7";

  const text = getTextColor(bg);

  return (
    <div
      style={{
        display: "inline-block",
        marginRight: 8,
        width: 40,
        minWidth: 40,
        height: 40,
        lineHeight: "40px",
        fontSize: name ? 18 : 15,
        fontWeight: "bold",
        textAlign: "center",
        backgroundColor: bg,
        color: text,
        borderRadius: 8,
      }}
    >
      {initials}
    </div>
  );
}
