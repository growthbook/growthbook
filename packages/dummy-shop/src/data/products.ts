export type Product = {
  id: string;
  name: string;
  price: number;
  category: string;
  description: string;
  imageHue: number;
};

export const PRODUCTS: Product[] = [
  {
    id: "cedar-mug",
    name: "Cedar Trail Mug",
    price: 28,
    category: "Kitchen",
    description:
      "Stoneware mug with a matte glaze. Holds 12 oz — built for slow mornings.",
    imageHue: 28,
  },
  {
    id: "linen-tote",
    name: "Market Linen Tote",
    price: 42,
    category: "Bags",
    description:
      "Heavyweight linen tote with reinforced straps. Room for a week's grocery run.",
    imageHue: 145,
  },
  {
    id: "wool-throw",
    name: "Harbor Wool Throw",
    price: 96,
    category: "Home",
    description: "Soft merino blend throw. Folds small, warms a whole couch.",
    imageHue: 210,
  },
  {
    id: "desk-lamp",
    name: "Arc Desk Lamp",
    price: 68,
    category: "Office",
    description:
      "Adjustable brass-finish lamp with a warm LED. Dims from task to ambient.",
    imageHue: 42,
  },
  {
    id: "ceramic-vase",
    name: "Ridge Ceramic Vase",
    price: 54,
    category: "Home",
    description:
      "Hand-thrown vase with a speckled finish. Looks good empty or with stems.",
    imageHue: 355,
  },
  {
    id: "notebook-set",
    name: "Field Notebook Set",
    price: 24,
    category: "Office",
    description: "Three A5 notebooks with dotted pages and a lay-flat binding.",
    imageHue: 185,
  },
];

export function getProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function formatPrice(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(amount);
}
