type OrCondition = {
  $or: Condition[];
};
type NorCondition = {
  $nor: Condition[];
};
type AndCondition = {
  $and: Condition[];
};
type NotCondition = {
  $not: Condition;
};
export type Operator =
  | "$in"
  | "$nin"
  | "$gt"
  | "$gte"
  | "$lt"
  | "$lte"
  | "$regex"
  | "$ne"
  | "$eq"
  | "$size"
  | "$elemMatch"
  | "$all"
  | "$not"
  | "$type"
  | "$exists";
type VarType =
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "null"
  | "undefined";
export type OperatorConditionValue = {
  $in?: (string | number)[];
  $nin?: (string | number)[];
  $gt?: number | string;
  $gte?: number | string;
  $lt?: number | string;
  $lte?: number | string;
  $regex?: string;
  $ne?: number | string;
  $eq?: number | string;
  $exists?: boolean;
  $all?: ConditionValue[];
  $size?: number | ConditionValue;
  $type?: VarType;
  $elemMatch?: Condition | OperatorConditionValue;
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
  | Record<string, any>;

export type OperatorCondition = {
  [key: string]: ConditionValue;
};

export type ConditionInterface =
  | OrCondition
  | NorCondition
  | AndCondition
  | NotCondition
  | OperatorCondition;

// eslint-disable-next-line
type TestedObj = Record<string, any>;