import { GrowthBook } from "..";

declare global {
  interface Window {
    _growthbook?: GrowthBook;
  }
}
