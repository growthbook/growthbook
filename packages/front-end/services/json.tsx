function recursiveSortExpandJSON(obj: object | string): object | string {
  if (typeof obj != "string" && typeof obj != "object") {
    return obj;
  }
  if (typeof obj == "string") {
    let jsonObj: object;
    try {
      jsonObj = JSON.parse(obj);
    } catch (e) {
      return obj;
    }
    obj = jsonObj;
  }

  if (!obj) {
    return obj;
  }

  // special case array to not transform it to an object below
  if (Array.isArray(obj)) {
    for (const i in obj) {
      obj[i] = recursiveSortExpandJSON(obj[i]);
    }
    return obj;
  }

  // return a new objects where the keys were added in deterministic (sorted) order
  return Object.keys(obj)
    .sort()
    .reduce(function (result, key) {
      result[key] = recursiveSortExpandJSON(obj[key]);
      return result;
    }, {});
}

export function toDiffableJSON(str: string): string {
  const obj = recursiveSortExpandJSON(str);
  if (typeof obj != "object") {
    return obj;
  }
  return JSON.stringify(obj, null, 2);
}
