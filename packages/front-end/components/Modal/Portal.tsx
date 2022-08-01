import { ReactNode } from "react";
import { FC, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const PORTAL_CONTAINER_ID = "modal";

const Portal: FC<{ children: ReactNode }> = ({ children }) => {
  const ref = useRef<HTMLElement>();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let el = document.getElementById(PORTAL_CONTAINER_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = PORTAL_CONTAINER_ID;
      document.body.append(el);
    }
    ref.current = el;
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return ref.current ? createPortal(children, ref.current) : <>{children}</>;
};
export default Portal;
