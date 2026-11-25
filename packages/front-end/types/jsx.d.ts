// TypeScript 5.1+ checks JSX tags against JSX.ElementType, so a component may
// return any ReactNode, as Lingui's <Trans> does. @types/react 18.2.8+ ships
// this; delete the file once the front-end is on it.
declare namespace JSX {
  type ElementType =
    | string
    | ((props: never) => React.ReactNode)
    | (new (props: never) => React.Component<unknown, unknown>);
}
