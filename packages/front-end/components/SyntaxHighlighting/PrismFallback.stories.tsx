import PrismFallback from "./PrismFallback";

export default {
  title: "Syntax Highlighting/PrismFallback",
  component: PrismFallback,
};

export const WithJSON = () => {
  return (
    <div>
      <PrismFallback
        style={{}}
        code={`{
  "features": {
    "dark_mode": {
      "defaultValue": false,
      "rules": [
        {
          "condition": {
            "loggedIn": true
          },
          "force": true,
          "coverage": 0.5,
          "hashAttribute": "id"
        }
      ]
    },
    "donut_price": {
      "defaultValue": 2.5,
      "rules": [
        {
          "condition": {
            "employee": true
          },
          "force": 0
        }
      ]
    }
  }
}
      `}
        language="json"
      />
    </div>
  );
};
