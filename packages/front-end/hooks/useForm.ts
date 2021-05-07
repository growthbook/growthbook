import {
  useState,
  ChangeEvent,
  useEffect,
  DetailedHTMLProps,
  HTMLAttributes,
} from "react";

type OnChange = ChangeEvent<
  HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
>;

export type AdditionalProps = Partial<
  DetailedHTMLProps<HTMLAttributes<HTMLInputElement>, HTMLInputElement>
>;

// eslint-disable-next-line
type Value = any;

type Primitive = string | number | boolean | null;

type Prop = {
  value: string;
  onChange: (e: OnChange) => void;
};

type Props =
  | Prop
  | Props[]
  | {
      [key: string]: Props;
    };

// Transform the original object (V) so that every primitive value is transformed
// to standard input props (`value` and `onChange`) plus any additional props (P).
// Works for arbitrarily nested objects and arrays.
export type InputProps<V, P, T = Value> = V extends Record<Value, Value>
  ? {
      [K in keyof V]: InputProps<V[K], P, Value>;
    }
  : V extends Array<T>
  ? InputProps<T, P, Value>[]
  : Prop & P;

function parseInputVal<T extends Primitive>(existing: T, inputVal: string): T {
  if (typeof existing === "string") {
    return inputVal as T;
  }
  if (typeof existing === "number") {
    return parseFloat(inputVal) as T;
  }
  if (typeof existing === "boolean") {
    return (inputVal === "true") as T;
  }
  return null;
}

function stringifyValue(value: Primitive): string {
  if (typeof value === "number") {
    return "" + value;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
}

// eslint-disable-next-line
function getProps<T, P extends AdditionalProps = {}>(
  value: T,
  setValue: (newVal: Value) => void,
  additionalProps?: P
): InputProps<T, P> {
  // Primitive
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    const ret = {
      ...additionalProps,
      value: stringifyValue(value),
      onChange: (e: OnChange) => {
        setValue(parseInputVal(value, e.target.value));
      },
    };
    return ret as InputProps<T, P>;
  }

  if (value === null || value === undefined) {
    throw new Error("Cannot pass 'undefined' or 'null' into useForm");
  }

  // Array
  if (Array.isArray(value)) {
    const ret = value.map((v, i) => {
      return getProps(
        v,
        (newVal: Value) => {
          const clone = [...value];
          clone[i] = newVal;
          setValue(clone);
        },
        additionalProps
      );
    });
    return ret as InputProps<T, P>;
  }

  // Object
  const props: Props = {};
  Object.keys(value).forEach((k) => {
    props[k] = getProps(
      value[k],
      (newVal: Value) => {
        setValue({
          ...value,
          [k]: newVal,
        });
      },
      additionalProps
    );
  });

  return props as InputProps<T, P>;
}

// eslint-disable-next-line
export default function useForm<T, P extends AdditionalProps = {}>(
  init: T,
  key = "unknown",
  additionalProps?: P
): [T, InputProps<T, P>, (updates: Partial<T>) => void] {
  const [value, setValue] = useState(init);

  // When the key changes, reset the value to the initial state
  useEffect(() => {
    setValue(init);
  }, [key]);

  return [
    value,
    getProps(value, setValue, additionalProps),
    // eslint-disable-next-line
    (updates: { [key: string]: any }): void => {
      const root = { ...value };
      Object.keys(updates).forEach((key) => {
        root[key] = updates[key];
      });
      setValue(root);
    },
  ];
}
