import {
  El,
  el,
  P,
  txt,
} from "back-end/src/services/notificationCards/cardImages";

export function dot(color: string, size = 8): El {
  return el("div", {
    display: "flex",
    width: size,
    height: size,
    borderRadius: 9999,
    backgroundColor: color,
  });
}

export function scLabel(text: string, extra: Record<string, unknown> = {}): El {
  return txt(text, {
    fontSize: 9.5,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: P.subtle,
    ...extra,
  });
}
