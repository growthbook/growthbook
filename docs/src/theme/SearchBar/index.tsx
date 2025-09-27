import { ReactNode, useEffect } from "react";
// eslint-disable-next-line import/no-unresolved
import SearchBar from "@theme-original/SearchBar";
import type SearchBarType from "@theme/SearchBar";
import type { WrapperProps } from "@docusaurus/types";

type Props = WrapperProps<typeof SearchBarType>;

export default function SearchBarWrapper(props: Props): ReactNode {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        e.target instanceof Element &&
        e.target.tagName !== "INPUT" &&
        e.target.tagName !== "TEXTAREA"
      ) {
        e.stopImmediatePropagation();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  return (
    <>
      <SearchBar {...props} />
    </>
  );
}
