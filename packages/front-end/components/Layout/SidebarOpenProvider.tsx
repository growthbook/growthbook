import React, {
  createContext,
  MutableRefObject,
  useContext,
  useRef,
  useState,
} from "react";
import type { AutoCollapseTrigger } from "./sidebarAutoCollapse";

type Props = {
  children: React.ReactNode;
};
/**
 * What the sidebar keeps across its remounts: entering or leaving Settings
 * remounts the app's layout (_app.tsx's SettingsForm), and the sidebar with it.
 * null until it first mounts in this page load.
 */
export type SidebarMemory = {
  /** Your saved choice, once read. */
  preferCollapsed: boolean | null;
  /** Triggers you expanded it over (sidebarAutoCollapse.ts). */
  expandedOver: AutoCollapseTrigger[];
  /** Whether one is mounted: across a remount, the old one's cleanup skips. */
  mounted: boolean;
};

type Context = {
  open: boolean;
  setOpen: React.Dispatch<boolean>;
  memory: MutableRefObject<SidebarMemory>;
  /**
   * Whether the new sidebar shows collapsed, as it sets on <html>; null until
   * one mounts. It outlives the sidebar's remounts, so one eases from it.
   */
  navCollapsed: boolean | null;
  setNavCollapsed: React.Dispatch<boolean>;
};

const SidebarOpenContext = createContext<Context | null>(null);

export const SidebarOpenProvider = ({ children }: Props) => {
  const [open, setOpen] = useState(false);
  const memory = useRef<SidebarMemory>({
    preferCollapsed: null,
    expandedOver: [],
    mounted: false,
  });
  const [navCollapsed, setNavCollapsed] = useState<boolean | null>(null);
  return (
    <SidebarOpenContext.Provider
      value={{ open, setOpen, memory, navCollapsed, setNavCollapsed }}
    >
      {children}
    </SidebarOpenContext.Provider>
  );
};

export const useSidebarOpen = () => {
  const context = useContext(SidebarOpenContext);

  if (!context)
    throw new Error(
      "SidebarOpen must be called from within the SidebarOpenProvider",
    );

  return context;
};
