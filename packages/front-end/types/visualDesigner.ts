export interface DomMutation {
  selector: string;
  action: "append" | "set" | "remove";
  attribute: string;
  value: string;
}

export type ElementBreadcrumb = string[];
export type ElementAttribute = {
  name: string;
  value: string;
};

type ReadyEvent = {
  event: "visualDesignerReady";
};
type ElementHoverEvent = {
  event: "elementHover";
  selector: string;
  display: string;
  breadcrumb: ElementBreadcrumb;
};
type ElementSelectedEvent = {
  event: "elementSelected";
  selector: string;
  display: string;
  breadcrumb: ElementBreadcrumb;
  innerHTML: string;
  attributes: ElementAttribute[];
};
export type OutgoingMessage =
  | ReadyEvent
  | ElementHoverEvent
  | ElementSelectedEvent;

type StartInspectingCommand = {
  command: "startInspecting";
};
type StopInspectingCommand = {
  command: "stopInspecting";
};
type IsReadyCommand = {
  command: "isReady";
};
type HoverElementCommand = {
  command: "hoverElement";
  selector: string;
  ancestor: number;
};
type SelectElementCommand = {
  command: "selectElement";
  selector: string;
  ancestor: number;
};
type InjectCSSMessage = {
  command: "injectCSS";
  css: string;
};
type MutateDOMMessage = {
  command: "mutateDOM";
  mutations: DomMutation[];
};

export type IncomingMessage =
  | StartInspectingCommand
  | StopInspectingCommand
  | HoverElementCommand
  | SelectElementCommand
  | InjectCSSMessage
  | MutateDOMMessage
  | IsReadyCommand;
