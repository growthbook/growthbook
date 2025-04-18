import { ReactNode, FC, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppearanceUIThemeProvider } from "@/services/AppearanceUIThemeProvider";
import { RadixTheme } from "@/services/RadixTheme";

export const PORTAL_CONTAINER_ID = "portal-root";

const Portal: FC<{ children: ReactNode }> = ({ children }) => {
  const ref = useRef<HTMLElement>();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const el = document.getElementById(PORTAL_CONTAINER_ID);
    if (!el) {
      return;
    }
    ref.current = el;
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const content = (
    <AppearanceUIThemeProvider>
      <RadixTheme>{children}</RadixTheme>
    </AppearanceUIThemeProvider>
  );

  return ref.current ? createPortal(content, ref.current) : content;
};
export default Portal;
