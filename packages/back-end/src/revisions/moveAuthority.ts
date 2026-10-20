// The implementation lives in shared so the front-end runs the same rule: a
// control the UI offers and the endpoint behind it must not disagree about who
// owns a move's destination.
export {
  holdsMoveDestination,
  moveDestination,
  projectScopeChanged,
  projectScopeChanged as isMove,
  type ProjectScoped,
} from "shared/permissions";
