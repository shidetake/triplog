import type { Category, RawExpense } from "./types.ts";

const MERCHANT_CATEGORY_MAP: Array<[RegExp, Category]> = [
  // 渡航
  [/delta|ana\b|jal\b|hawaiian air|united|american air|jetblue/i, "渡航"],
  [/narita express|nex|n'ex|airport limousine|京成スカイライナー/i, "渡航"],
  // 宿泊
  [/royal hawaiian|halekulani|marriott|hilton|hyatt|sheraton|moana surfrider/i, "宿泊"],
  // 現地移動
  [/uber|lyft|taxi|bus pass|the bus|holo card/i, "現地移動"],
  // 飲食
  [/howzit|hana koa|hula grill|yard house|island vintage|orchids|brewing|bar\b|cafe|coffee|starbucks|restaurant/i, "飲食"],
  // エンタメ
  [/star of honolulu|aquarium|polynesian cultural|luau|waikiki shell/i, "エンタメ"],
  // 通信
  [/wifi|pocketalk|wi-?fi|t-?mobile|verizon|at&t|ローミング/i, "通信"],
];

export function suggestCategory(expense: RawExpense): Category | null {
  if (expense.category) return expense.category;
  const target = `${expense.merchantRaw} ${expense.merchant} ${expense.detail ?? ""}`;
  for (const [re, cat] of MERCHANT_CATEGORY_MAP) {
    if (re.test(target)) return cat;
  }
  return null;
}

export function categorize(expenses: RawExpense[]): RawExpense[] {
  return expenses.map((e) => {
    if (e.category) return e;
    const suggested = suggestCategory(e);
    if (suggested) return { ...e, category: suggested };
    return e; // カテゴリ未確定 → ユーザー判断に委ねる
  });
}
