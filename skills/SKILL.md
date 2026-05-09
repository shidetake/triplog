# SKILL — 旅行収支抽出メイン手順

`/trip <slug>` で1旅行を処理する際の標準手順。
個別ルールは `skills/rules/*.md`、出力フォーマットは `skills/templates/output-schema.md` を参照。

---

## 0. 前提

- `trips/<slug>/config.json` が用意されていること
- `.mcp.json` の Gmail / gsheets MCP が認証済みであること
- 対象シート以外は **読み取りすら極力避ける**（書き込みは絶対禁止）

---

## 1. config.json を読み込む

最低限必要なフィールド：

```json
{
  "slug": "2026-04-hawaii",
  "spreadsheetId": "1QEUhnI0BQjfrSXbEmS5WjkGcLTYGXU9D3fNSe59cXV4",
  "sheetName": "2026-04Hawaii",
  "headerRow": 18,
  "dataStartRow": 19,
  "writeRange": "B19:I",
  "period": { "start": "2026-04-28", "end": "2026-05-05" },
  "originAirport": "NRT",
  "destinationAirport": "HNL",
  "primaryStay": "Royal Hawaiian",
  "queries": [
    "from:(no-reply OR receipt OR receipts) \"$\" after:2026/04/28 before:2026/05/06",
    "from:banking ご利用 after:2026/04/28 before:2026/05/07",
    "from:banking ご利用金額確定 after:2026/04/28 before:2026/05/07",
    "from:deltaairlines receipt SASAKI",
    "from:uber.com receipt after:2026/04/27 before:2026/05/07",
    "subject:(receipt OR confirmation OR folio) after:2026/04/28 before:2026/05/06"
  ],
  "fxRateOverride": null
}
```

---

## 2. Gmail から候補メールを集める

1. `config.queries` を順に `mcp__gmail__search_emails` に投げる
2. messageId のセットで重複排除
3. 各メッセージについて：
   - `mcp__gmail__read_email` で本文取得
   - 添付があれば `mcp__gmail__download_attachment` で取得し、PDFは `pdf-parse` 等でテキスト化
4. ダンプ先： `trips/<slug>/raw/<messageId>.json` （メタ＋本文＋添付パス）

raw ディレクトリは `.gitignore` 対象。

---

## 3. メールごとに構造化JSONへ抽出

`@expense-extractor` サブエージェントを使う。1メール1呼び出し、入力は raw ファイル、出力は次のスキーマ：

```ts
type RawExpense = {
  source: "sony-bank-auth" | "sony-bank-confirm" | "receipt-email" | "hotel-folio" | "airline" | "rideshare" | "other";
  messageId: string;
  occurredAt: string;        // ISO8601 利用日時（不明なら日付のみ "YYYY-MM-DD"）
  merchantRaw: string;
  merchant: string;          // 正規化後の表示用（"TST*", "SQ*" 等は除去）
  amountLocal: number | null;
  currencyLocal: string;     // "USD", "JPY"
  amountJPY: number | null;  // Sony銀行確定額がある場合のみ
  tipLocal: number | null;
  category?: string;         // 確証ある場合のみ。なければ後段で推定
  detail?: string;           // メニュー名・区間・部屋種別など
  notes?: string;
}
```

抽出が困難なフィールドは `null` のまま残す（推測しない）。

中間ファイル： `trips/<slug>/raw/extracted.json`（RawExpense配列）

---

## 4. 正規化パイプライン

`scripts/` の関数を順に通す。pure function なので CLI でもインライン Node でも OK。

1. `dedup` — `skills/rules/dedup-rules.md`
2. `tipMerge` — `skills/rules/tip-rules.md`
3. `categorize` — `skills/rules/categories.md`
4. `applyFx` — `skills/rules/fx-rules.md`
5. `applyDateRules` — `skills/rules/date-rules.md`
6. `buildTsv` — `skills/templates/output-schema.md`

最終結果は `trips/<slug>/output.tsv`（実値、数式なし）。

---

## 5. ユーザー確認

書き込み前に必ず以下を提示：

- 件数（行数）
- カテゴリ別合計（円）
- 対象シートの現在の行範囲（`B19:I80` など、読み取りのみ）
- 上書きされる行範囲

ユーザーが明示的に許可するまで `mcp__gsheets__update_cells` / `batch_update_cells` を呼ばない。

---

## 6. シート書き込み

- 範囲： `<sheetName>!B19:I<最終行>`
- I列（計算対象外）は明示的に `FALSE`
- 数式は使わず値で書く
- ツール: `mcp__gsheets__update_cells`（単一範囲）または `batch_update_cells`（複数範囲）
- 書き込み後、`mcp__gsheets__get_sheet_data` で同じ範囲を読み返して件数・合計が一致することを確認

---

## 7. 後片付け

- `output.tsv` をコミット対象に（`.gitignore` で除外しているので明示的に `git add -f` するか、レビュー用のコピーを別パスに）
- `raw/` は `.gitignore` 対象のままでOK

---

## やってはいけないこと

- 対象シート以外への書き込み・クリア・削除
- 推測値での欄埋め
- 確定日ベースの記録（必ず利用日）
- 「とりあえず動く」ためにルールを緩める変更
