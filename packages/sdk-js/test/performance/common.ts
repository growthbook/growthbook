export const payload = {
  features: {
    feature: {
      defaultValue: false,
      rules: [
        {
          condition: {
            country: "US",
          },
          variations: [false, true],
          weights: [0, 1],
        },
      ],
    },
  },
};

export function getAttributes(i: number) {
  return {
    id: i + "",
    country: "US",
  };
}

export const NUM_ITERATIONS = 1000000;
