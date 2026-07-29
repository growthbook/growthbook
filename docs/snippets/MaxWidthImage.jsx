export const MaxWidthImage = ({ maxWidth = 800, border = false, caption, children }) => {
  return (
    <figure
      style={{ maxWidth: `${maxWidth}px` }}
      className={[
        "mx-auto my-5 text-center",
        "[&_img]:block [&_img]:mx-auto",
        border ? "[&_img]:border [&_img]:border-[var(--color-border)]" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
      {caption && <figcaption className="mt-2 text-[0.9em] text-center opacity-80">{caption}</figcaption>}
    </figure>
  );
};
