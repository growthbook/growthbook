// Check if two types are equal
export type IfEqual<U, V, True, False = never> = [U] extends [V]
  ? [V] extends [U]
    ? True
    : False
  : False;
