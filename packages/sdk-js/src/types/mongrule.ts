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
/**
 * Names one saved group, and optionally the attribute to check it against
 * instead of the one on the group's own payload entry.
 *
 * An object rather than a bare id so a field can be added later without a new
 * capability. Readers must ignore keys they do not know.
 */
export type SavedGroupReference = {
  id: string;
  attributeKey?: string;
};

/**
 * A reference to one saved group. Top level like `$and`, not scoped to an
 * attribute. The plural authoring operator `$savedGroups` never reaches an
 * SDK, so it has no type here.
 */
type SavedGroupCondition = {
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

export type ConditionInterface =
  | OrCondition
  | NorCondition
  | AndCondition
  | NotCondition
  | SavedGroupCondition
  | OperatorCondition;

export type ParentConditionInterface = {
  id: string;
  condition: ConditionInterface;
  gate?: boolean;
};

// eslint-disable-next-line
export type TestedObj = Record<string, any>;
