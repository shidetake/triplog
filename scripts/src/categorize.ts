import type { Category, RawExpense } from "./types.ts";

const MERCHANT_CATEGORY_MAP: Array<[RegExp, Category]> = [
  // 渡航（航空会社）— ana/jal は前後にスペースのみで囲まれた完全一致だけ
  [/\bdelta\b|(?<![A-Z])(ANA|JAL)(?![A-Z])|hawaiian air|united air|american air|jetblue/i, "渡航"],
  [/narita express|\bnex\b|n'ex|airport limousine|京成スカイライナー/i, "渡航"],

  // 飲食（先に拾う）— レストラン・バー・カフェ・ベーカリー・ブルワリー
  [
    /howzit|hana koa|hula grill|yard house|island vintage|orchids|brewing|cafe|coffee|starbucks|restaurant|leahi|smash burger|tutu|treats|bakery|nalu|moni\s|kai coffee|honolulu coffee|beach bar|surf lanai|mai tai|village bottle|uloha|hitea|the bus drink/i,
    "飲食",
  ],

  // 宿泊（ホテル名のみ。レストランは飲食で既に拾われる前提）
  [/^(the\s+)?royal hawaiian\s*$|^(the\s+)?royal hawaiian\s+(hotel|resort|waikiki)|halekulani(?!\s+orchids)|\bmarriott\b|\bhilton\b|\bhyatt\b|moana surfrider(?!.*(coffee|kiosk))/i, "宿泊"],

  // 現地移動
  [/uber|lyft|taxi|bus pass|the bus|holo card/i, "現地移動"],

  // エンタメ（ツアー・入場料・アクティビティ）
  [/star of honolulu|aquarium|polynesian cultural|luau|waikiki shell|diamond head|hanauma|dive oahu|snorkel|ssa\b/i, "エンタメ"],

  // 通信
  [/wifi|pocketalk|wi-?fi|t-?mobile|verizon|at&t|ローミング|ubigi|transatel/i, "通信"],

  // お土産（土産物・ホテルギフトショップ・特産品）
  [/honolulu cookie|hawaii tile|trh inspired|royal hawaiian center|royal hawaiian c\b|ala moana center|abc store|abc\s*#|aloha collection|kahala\s*-\s*royal/i, "お土産"],

  // 衣服
  [/uniqlo|alo yoga|alo-yoga|alo　yoga|patagonia|lululemon|nike|adidas/i, "衣服"],

  // 飲食（スーパーマーケット — 食料品中心）
  [/whole ?foods|whole ?fds|safeway|times super|waikiki market|foodland/i, "飲食"],

  // 医療（ドラッグストア／薬局・クリニック）
  [/longs|cvs|walgreens|pharmacy|clinic|hospital|urgent care/i, "医療"],

  // カジノ
  [/casino|caesars|wynn|bellagio|mgm|sands|hard rock hotel|poker|slot/i, "カジノ"],

  // その他（雑貨・ディスカウント — 用途が混ざるので最後）
  [/don ?quijote|target|walmart|costco/i, "その他"],
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
    return e;
  });
}
