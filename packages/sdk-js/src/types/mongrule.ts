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
  | OperatorCondition;

// eslint-disable-next-line
export type TestedObj = Record<string, any>;
