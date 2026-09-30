import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getProduct, type Product } from "../data/products";

export type CartLine = {
  productId: string;
  quantity: number;
};

type CartContextValue = {
  lines: CartLine[];
  itemCount: number;
  subtotal: number;
  addItem: (productId: string, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clear: () => void;
  linesWithProducts: Array<CartLine & { product: Product }>;
};

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "cedar-market-cart";

function loadCart(): CartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (line): line is CartLine =>
        typeof line === "object" &&
        line !== null &&
        "productId" in line &&
        "quantity" in line,
    );
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => loadCart());

  const persist = useCallback((next: CartLine[]) => {
    setLines(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const addItem = useCallback(
    (productId: string, quantity = 1) => {
      persist(
        (() => {
          const existing = lines.find((l) => l.productId === productId);
          if (existing) {
            return lines.map((l) =>
              l.productId === productId
                ? { ...l, quantity: l.quantity + quantity }
                : l,
            );
          }
          return [...lines, { productId, quantity }];
        })(),
      );
    },
    [lines, persist],
  );

  const setQuantity = useCallback(
    (productId: string, quantity: number) => {
      if (quantity <= 0) {
        persist(lines.filter((l) => l.productId !== productId));
        return;
      }
      persist(
        lines.map((l) => (l.productId === productId ? { ...l, quantity } : l)),
      );
    },
    [lines, persist],
  );

  const removeItem = useCallback(
    (productId: string) => {
      persist(lines.filter((l) => l.productId !== productId));
    },
    [lines, persist],
  );

  const clear = useCallback(() => persist([]), [persist]);

  const linesWithProducts = useMemo(
    () =>
      lines
        .map((line) => {
          const product = getProduct(line.productId);
          return product ? { ...line, product } : null;
        })
        .filter(
          (line): line is CartLine & { product: Product } => line !== null,
        ),
    [lines],
  );

  const itemCount = linesWithProducts.reduce((sum, l) => sum + l.quantity, 0);
  const subtotal = linesWithProducts.reduce(
    (sum, l) => sum + l.product.price * l.quantity,
    0,
  );

  const value = useMemo(
    () => ({
      lines,
      itemCount,
      subtotal,
      addItem,
      setQuantity,
      removeItem,
      clear,
      linesWithProducts,
    }),
    [
      lines,
      itemCount,
      subtotal,
      addItem,
      setQuantity,
      removeItem,
      clear,
      linesWithProducts,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used within CartProvider");
  }
  return ctx;
}
