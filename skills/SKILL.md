# SKILL — 旅行収支抽出メイン手順

`/trip <slug>` で1旅行を処理する標準手順。
個別ルールは `skills/rules/*.md`、出力フォーマットは `skills/templates/output-schema.md` を参照。

---

## 0. 前提

- `trips/<slug>/config.json` が用意されていること
- `.mcp.json` の Gmail / gsheets MCP が認証済みであること
- 対象シート以外は **読み取りすら極力避ける**（書き込みは絶対禁止）

---

## 0.5. 実行モード（reuse-raw / 取り直し）

`/trip <slug>` 起動時、`trips/<slug>/raw/` に未除外の `<messageId>.json` が**既に1件以上存在する場合は reuse-raw モード**で動く（Gmail 取得=手順2/2.5/3 をスキップ）。

理由: `raw/<messageId>.json` は決定的なスナップショットなので、パーサ修正の動作確認はキャッシュ済み raw に対して回せばトークン消費なしで本番経路と同一になる。Gmail 検索ロジック・noise filter を変えたときだけ `--force-refetch` で取り直す。

挙動:

- 既定: raw が存在 → reuse-raw / 存在しない → 通常取得
- `--reuse-raw`: 明示。raw が空ならエラー
- `--force-refetch`: 明示。手順3を再実行（raw を上書き）

reuse-raw で動かしたとき、ユーザー確認時にその旨を必ず明示する。

---

## 1. config.json を読み込む

主要フィールド：

```json
{
  "slug": "2026-04-hawaii",
  "spreadsheetId": "...",
  "sheetName": "2026-04Hawaii",
  "headerRow": 18,
  "dataStartRow": 19,
  "writeRange": "B19:I",
  "period": { "start": "2026-04-28", "end": "2026-05-05" },
  "primaryStay": "Royal Hawaiian",
  "queries": [...],
  "noiseFilters": {
    "fromDomains": [...],
    "subjectPatterns": [...]
  },
  "fxRateOverride": null
}
```

---

## 2. Gmail から候補メールを集める

`config.queries` を順に `mcp__gmail__search_emails` に投げ、`{messageId, from, subject, date}` のメタリストを作る。重複 messageId は集約。

---

## 2.5. ノイズ除去（A2）

`scripts/src/filter.ts` の `applyNoiseFilters()` を使い、`config.noiseFilters` でメッセージを間引く。
落ちたものは `trips/<slug>/raw/filtered-out.json` に reason 付きで残す（後で誤フィルタを発見したら config を更新）。

---

## 3. raw ダンプ（Gmail → ローカル）

残ったメッセージそれぞれについて：

1. `mcp__gmail__read_email` で本文取得
2. PDF 添付があれば `mcp__gmail__download_attachment` で `trips/<slug>/raw/<messageId>-<filename>.pdf` に保存
3. PDF は `scripts/src/parsers/marriott-folio.ts` などで `pdf-parse` 経由でテキスト化（`textContent` フィールドに収納）
4. ダンプ先: `trips/<slug>/raw/<messageId>.json`（`RawMessage` 型）

巨大 HTML（Uber 等）は本文丸ごと保存して構わない（後段の `stripHtml()` で処理）。
このダンプは subagent に任せて context を汚さないのがおすすめ（大量の本文が main context を埋めるのを避ける）。

---

## 3.5. Square full-receipt enrichment（reuse-raw でも必ず実行）

Square のメール本文は `You paid $X to <merchant> ...` の1文と `https://squareup.com/r/<hash>` の URL のみで、品目は外部ページにある。`raw/<messageId>.json` を全件走査し:

1. `from` が `messaging.squareup.com` を含み、かつ `linkedContent` が未設定のものを対象に絞る
2. 本文中の `https://squareup.com/r/[A-Za-z0-9]+` URL を抽出
3. `WebFetch` で取得。プロンプトは「Square receipt の品目行のみを `<qty> <name> $<price>` 形式で1行ずつ返す。subtotal/tax/tip/total/payment は除外」
4. 返ってきた文字列を `RawMessage.linkedContent` フィールドにセットして raw JSON にマージ保存（既存フィールドは破壊しない）

WebFetch が 404 / expired を返したら linkedContent は未設定のまま残し、detail は空欄で続行する（過剰に retry しない）。

reuse-raw モードであっても、`linkedContent` が無い Square 行があればここで埋める（古い raw キャッシュに後から enrichment を足せる仕組み）。

---

## 4. 構造化抽出（Deterministic + Agent fallback）

### 4.1 Deterministic パース

`npm run extract <slug>` を実行：

- `trips/<slug>/raw/*.json` を全部読む
- `parsers/route.ts` の `detectSource()` でソース判定
- 既知ソースは専用パーサで `RawExpense` 化：
  - `parsers/sony-bank.ts`（auth/confirm 両対応）
  - `parsers/toast.ts`（toasttab.com）
  - `parsers/square.ts`（messaging.squareup.com）
  - `parsers/uber.ts`（noreply@uber.com、日本語Subject）
  - `parsers/marriott-folio.ts`（PDF テキスト前提）
- 出力:
  - `trips/<slug>/raw/extracted.json`（パース成功した `RawExpense[]`）
  - `trips/<slug>/raw/needs-agent.json`（パース失敗・未対応ソースの一覧）

### 4.2 Agent フォールバック

`needs-agent.json` が空でなければ、各メッセージに対して `@expense-extractor` サブエージェントを呼ぶ（`messageId` 渡し）。エージェントは raw を読み直して `RawExpense[]` を返す。
返ってきた配列を `extracted.json` に追記。

---

## 5. 正規化パイプライン

`npm run pipeline <slug>` を実行：

1. `dedup` — `skills/rules/dedup-rules.md`
2. `tipMerge` — `skills/rules/tip-rules.md`
3. `categorize` — `skills/rules/categories.md`
4. `applyFx` — `skills/rules/fx-rules.md`
5. `applyDateRules` — `skills/rules/date-rules.md`
6. `buildTsv` — `skills/templates/output-schema.md`

最終結果は `trips/<slug>/output.tsv`（実値、数式なし）。

---

## 6. ユーザー確認

書き込み前に必ず以下を提示：

- 件数（行数）
- カテゴリ別合計（円）
- 対象シートの現在の行範囲（`B19:I80` など、読み取りのみ）
- 上書きされる行範囲

ユーザーが明示的に許可するまで `mcp__gsheets__update_cells` / `batch_update_cells` を呼ばない。

---

## 7. シート書き込み

- 範囲： `<sheetName>!B19:F<最終行>` と `<sheetName>!H19:I<最終行>` の2範囲（**G列は触らない**）
- ツール: `mcp__gsheets__batch_update_cells`（必ず batch、単一の `update_cells` で B:I を一括書きしないこと — G の formula を破壊する）
- I列（計算対象外）は明示的に `FALSE`
- 数式は使わず値で書く
- **JPY 通貨の行は F (現地価格) を空文字 `""` にする**。H (円) にだけ金額。シート側の formula `=IF(ISBLANK($F),"",$H/$F)` で G が自動的に空になる
- 外貨行は F に現地金額、H に円額。G は formula が auto rate 計算
- 書き込み後、`mcp__gsheets__get_sheet_data` で同範囲を読み返して件数・合計が一致することを確認

---

## やってはいけないこと

- 対象シート以外への書き込み・クリア・削除
- 推測値での欄埋め
- 確定日ベースの記録（必ず利用日）
- 「とりあえず動く」ためにルールを緩める変更
- detail 列にチップ・タックス情報を入れる（情報量0。品目のみ書く）
