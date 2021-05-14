import { useEffect } from "react";
import { useState } from "react";
import { ReactElement } from "react";
import { createPortal } from "react-dom";

export default function Portal({ children }: { children: ReactElement }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted ? createPortal(children, document.body) : null;
}
