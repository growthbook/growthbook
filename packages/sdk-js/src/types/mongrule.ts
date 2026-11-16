import type { SavedGroupsPayload, WidenPrimitives } from "./growthbook";

type OrCondition = {
  $or: ConditionInterface[];
};
type NorCondition = {
  $nor: ConditionInterface[];
};
type AndCondition = {
  $and: ConditionInterface[];
};
type NotCondition = {
  $not: ConditionInterface;
};
/** Names one saved group. Unknown keys are ignored. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SavedGroupReference<A = any> = {
  id: string;
  /** Optional. Checks this attribute instead of the entry's own. */
  attributeKey?: AttributePath<A>;
};

/**
 * A reference to one saved group. Top level like `$and`, not scoped to an
 * attribute. The plural authoring operator `$savedGroups` never reaches an
 * SDK, so it has no type here.
 */
export type SavedGroupCondition = {
  $savedGroup: SavedGroupReference;
};
export type Operator =
  | "$in"
  | "$ini"
  | "$inGroup"
  | "$nin"
  | "$nini"
  | "$notInGroup"
  | "$gt"
  | "$gte"
  | "$lt"
  | "$lte"
  | "$regex"
  | "$regexi"
  | "$ne"
  | "$eq"
  | "$size"
  | "$elemMatch"
  | "$all"
  | "$alli"
  | "$not"
  | "$type"
  | "$exists"
  | "$vgt"
  | "$vgte"
  | "$vlt"
  | "$vlte"
  | "$vne"
  | "$veq";
export type VarType =
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "null"
  | "undefined";
export type ConditionTypeMismatch = {
  path: string;
  /** `$eq` for implicit equality */
  operator: string;
  /** Condition value */
  expected: unknown;
  /** Attribute value, `null` when missing */
  actual: unknown;
};
export type TypeMismatchCallback = (mismatch: ConditionTypeMismatch) => void;
export type EvalConditionOptions = {
  /** Required for saved group operators to match anyone */
  savedGroups?: SavedGroupsPayload;
  onTypeMismatch?: TypeMismatchCallback;
};
export type OperatorConditionValue = {
  $in?: (string | number)[];
  $ini?: (string | number)[];
  $inGroup?: string;
  $nin?: (string | number)[];
  $nini?: (string | number)[];
  $notInGroup?: string;
  $gt?: number | string;
  $gte?: number | string;
  $lt?: number | string;
  $lte?: number | string;
  $regex?: string;
  $regexi?: string;
  $ne?: number | string;
  $eq?: number | string;
  $exists?: boolean;
  $all?: ConditionValue[];
  $alli?: ConditionValue[];
  $size?: number | ConditionValue;
  $type?: VarType;
  $elemMatch?: ConditionInterface | OperatorConditionValue;
  $not?: ConditionValue;
};

export type ConditionValue =
  | OperatorConditionValue
  | string
  | number
  | boolean
  // eslint-disable-next-line
  | Array<any>
  // eslint-disable-next-line
  | Record<string, any>
  | null;

export type OperatorCondition = {
  [key: string]: ConditionValue;
};

type UntypedCondition =
  | OrCondition
  | NorCondition
  | AndCondition
  | NotCondition
  | SavedGroupCondition
  | OperatorCondition;

// With an attributes type, a condition written in code is checked against it:
// unknown attributes, and operators or values that don't fit the attribute's
// type, are errors. Without one (the default) any condition is accepted.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ConditionInterface<A = any> = A extends unknown
  ? string extends keyof A
    ? UntypedCondition
    : {
        $or?: ConditionInterface<A>[];
        $nor?: ConditionInterface<A>[];
        $and?: ConditionInterface<A>[];
        $not?: ConditionInterface<A>;
        $savedGroup?: SavedGroupReference<A>;
      } & {
        [P in AttributePath<A>]?: AttributeConditionValue<AttributeValue<A, P>>;
      }
  : never;

type ObjectOf<V> = V extends readonly unknown[]
  ? never
  : V extends object
    ? V
    : never;
type ElementOf<V> = V extends readonly (infer E)[] ? E : never;
type Scalar = string | number | boolean;
// Adds the operators when some part of the attribute's type supports them
type OperatorsFor<T, Operators> = [T] extends [never] ? unknown : Operators;

/** Attribute names, and dot paths into object attributes (`company.plan`) */
export type AttributePath<A, Depth extends 0[] = []> = A extends unknown
  ? string extends keyof A
    ? string
    : {
        [K in keyof A & string]:
          | K
          // Stops after 4 levels, so a recursive type can't loop forever
          | (Depth["length"] extends 3
              ? never
              : `${K}.${AttributePath<ObjectOf<A[K]>, [...Depth, 0]>}`);
      }[keyof A & string]
  : never;

// The type of the attribute at a path. `unknown` leaves its conditions unchecked.
type AttributeValue<A, P extends string> = A extends unknown
  ? P extends keyof A
    ? A[P]
    : P extends `${infer K}.${infer Rest}`
      ? K extends keyof A
        ? AttributeValue<ObjectOf<A[K]>, Rest>
        : unknown
      : unknown
  : never;

/** What an attribute of type V can be compared to: a value to equal, or operators */
export type AttributeConditionValue<V> = unknown extends V
  ? ConditionValue
  : V | null | AttributeOperators<V>;

/** The operators that work on an attribute of type V */
export type AttributeOperators<V> = {
  $exists?: boolean;
  $type?: VarType;
  $not?: AttributeConditionValue<V>;
  // A missing attribute is null, so any attribute can be compared to null
  $eq?: Extract<V, Scalar> | null;
  $ne?: Extract<V, Scalar> | null;
} &
  // An array attribute matches when any of its elements is in the list
  OperatorsFor<
    Extract<V | ElementOf<V>, Scalar>,
    {
      $in?: (Extract<V | ElementOf<V>, Scalar> | null)[];
      $nin?: (Extract<V | ElementOf<V>, Scalar> | null)[];
      $inGroup?: string;
      $notInGroup?: string;
    }
  > &
  OperatorsFor<
    Extract<V | ElementOf<V>, string>,
    {
      $ini?: (Extract<V | ElementOf<V>, string> | null)[];
      $nini?: (Extract<V | ElementOf<V>, string> | null)[];
    }
  > &
  OperatorsFor<
    Extract<V, string | number>,
    {
      [K in
        | "$gt"
        | "$gte"
        | "$lt"
        | "$lte"
        | "$veq"
        | "$vne"
        | "$vgt"
        | "$vgte"
        | "$vlt"
        | "$vlte"]?: WidenPrimitives<Extract<V, string | number>>;
    }
  > &
  OperatorsFor<Extract<V, string>, { $regex?: string; $regexi?: string }> &
  OperatorsFor<
    ElementOf<V>,
    {
      $size?: AttributeConditionValue<number>;
      // Operators test each element, and a condition tests an element's fields
      $elemMatch?:
        | AttributeOperators<ElementOf<V>>
        | ConditionInterface<ObjectOf<ElementOf<V>>>;
      $all?: AttributeConditionValue<ElementOf<V>>[];
      $alli?: AttributeConditionValue<ElementOf<V>>[];
    }
  >;

export type ParentConditionInterface = {
  id: string;
  condition: ConditionInterface;
  gate?: boolean;
};

// eslint-disable-next-line
export type TestedObj = Record<string, any>;
