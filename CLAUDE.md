# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Gmail の領収書メール（本文・PDF添付）から旅行収支を抽出し、Google Spreadsheet に利用日昇順で書き込むツール。`/trip <slug>` 1コマンドで「Gmail 検索 → ノイズ除去 → raw ダンプ → 決定的パース → agent fallback → 正規化 → output.tsv → 承認 → シート書き込み」までを通す。

ユーザー操作は基本的にスラッシュコマンド経由で、Claude Code 内の MCP（gmail / gsheets）が裏で動く前提。スクリプトは決定的処理だけを担当する純TS、LLM 判断は `expense-extractor` agent に閉じている。

## 主要コマンド

すべて `scripts/` ディレクトリ配下で実行する（`cli.ts` が `process.cwd()` 直下を `projectRoot` として扱うため、必ず `scripts/` から `npm run` する）。

```bash
cd scripts
npm install                            # 初回のみ
npm run typecheck                      # tsc --noEmit
npm run extract <slug>                 # raw/*.json → extracted.json + needs-agent.json
npm run pipeline <slug>                # extracted.json → output.tsv（dedup→tipMerge→categorize→fx→tsv）
npm run auth:sheets                    # Sheets MCP の OAuth トークン発行（独自スクリプト、初回 + 7日切れ時）
```

Gmail MCP の認証切れ時:
```bash
npx @gongrzhe/server-gmail-autoauth-mcp auth
```

スクリプト単体テストは存在しない。動作確認はハワイ旅行 (`trips/2026-04-hawaii/`) のリプロを通じて行うのが慣例（README §4 参照）。

## アーキテクチャ

### パイプライン全体像

```
config.queries → mcp__gmail__search_emails       (1) Gmail 検索
              → applyNoiseFilters (filter.ts)    (2) ノイズ除去
              → mcp__gmail__read_email           (3) 本文取得 → raw/<messageId>.json
              + mcp__gmail__download_attachment      （PDF は pdf-parse でテキスト化して同 JSON に格納）
              → npm run extract                  (4) detectSource() → 専用パーサ → extracted.json + needs-agent.json
              → @expense-extractor agent         (5) 未対応ソースの fallback
              → npm run pipeline                 (6) dedup → tipMerge → categorize → applyFx → buildTsv
              → output.tsv                       (7) ユーザー承認
              → mcp__gsheets__update_cells       (8) <sheetName>!B19:I<n> に書き込み
```

ステップ (4)-(6) は決定的TS、(1)(3)(5)(8) は MCP / agent。Claude が触るのは (1)(3)(5)(7)(8)。

### 1旅行 = 1 config + 1 raw ディレクトリ

`trips/<slug>/config.json` 1ファイルで旅行を定義する。`config.queries` / `config.noiseFilters` はその旅行固有のチューニング項目（共通デフォルトは未実装、HANDOFF §5.5 残件）。

`trips/<slug>/raw/` 配下のファイル意味:
- `<messageId>.json` — `RawMessage` 型（本文・添付テキスト含む）。**git無視**
- `extracted.json` — `extract.ts` の出力 (`RawExpense[]`)
- `needs-agent.json` — 決定的パーサが落ちたメッセージ（agent fallback 入力）
- `filtered-out.json` — ノイズフィルタで落ちたメッセージ（誤フィルタ検知用）
- `agent-fallback.json` — agent / 手動で書いた `RawExpense[]`（過去旅行の参考）

### ソース判定とパーサ追加の流れ

`scripts/src/parsers/route.ts` の `detectSource()` が送信元ドメインで `ParserKind` に振り分け、`extract.ts` の switch で対応パーサに渡す。新フォーマット対応の典型手順:

1. `parsers/route.ts` に新しい `ParserKind` を追加し、`from.includes(...)` 判定を書く
2. `parsers/<source>.ts` を実装（`(msg: RawMessage) => ParseResult` シグネチャ）
3. `extract.ts` の switch case に1行追加
4. `PARSER_TO_SOURCE` を更新

ホテルFolio のような「1メール → 複数 RawExpense」は、`expense.notes` に `__FANOUT__:<JSON>` を仕込むと `extract.ts` が展開する（`marriott-folio.ts` 参照）。

### 重複排除とチップマージの2段階

Sony 銀行は同一取引で **「ご利用速報」+「ご利用金額確定」+ 店レシート** の最大3通を送る。さらにチップは確定通知でしか分からない:

- `dedup.ts` — マーチャント正規化（`TST*`/`SQ*` 等のプレフィックス除去）+ 金額±25% + 時刻±72h で同一取引判定。ソース優先順位 (`hotel-folio` > `receipt-email`/`airline`/`rideshare` > `sony-bank-confirm` > `sony-bank-auth`) で代表を選ぶが、`amountJPY` は confirm から、`occurredAt` は auth から拾う（**利用日 = 速報側**、HANDOFF §4.5）。
- `tip-merge.ts` — dedup を通った後、同マーチャント・72h 内の `auth + confirm` ペアの差分を `tipLocal` として保持。**現状は sony-bank-auth/confirm ペアのみ対応**（小額単独 auth の親への吸収は HANDOFF §5.3 の残件）。

`build-tsv.ts` の `compareExpenses()` は「日付 → 時刻 → カテゴリの自然順 (`CATEGORY_ORDER`)」でソート。シート列順は `categorize.ts` の `MERCHANT_CATEGORY_MAP` で確定する。

### FX 換算

`fx.ts` の `resolveFx()` の優先順位:
1. `amountJPY` がすでにある (Sony 銀行 confirm) → `fxRate: "BANK"`
2. JPY 建て → `fxRate: 1`
3. `config.fxRateOverride` で換算 → 数値レート

**重要な現実**: HANDOFF §4.6 では「Sony 銀行 confirm に円額が入る」と書かれているが、実メールは USD のみ（README §5.2）。現状は `fxRateOverride` 固定値で運用、レート列は固定値表示になる。

## 厳守事項（権限と書き込み）

- **対象シート (`config.sheetName`) 以外への読み書きは絶対禁止**。同 spreadsheet 内の他シートも読まない
- 推測値で欄を埋めない（不明は `null` または空欄）
- 確定日ベースの記録 NG。**必ず利用日**
- 削除系 MCP は `.claude/settings.json` で deny 済み（gmail delete/send/draft/modify、gsheets create/share/delete/clear）。`mcp__gsheets__update_cells` / `batch_update_cells` 以外の書き込み系は呼ばない
- シート書き込み前に **件数 / カテゴリ別合計 / 上書き範囲** を提示してユーザー承認を取る（`/trip` の手順10〜12）
- 書き込み直後に同範囲を `get_sheet_data` で読み返して件数・合計が一致することを確認

## ドキュメント階層

- `README.md` — 構成・セットアップ・直近のドッグフーディング結果・**残件 §5**
- `HANDOFF.md` — Chrome 拡張時代の引き継ぎ資料（ドメイン知見・チップルール・カテゴリ語彙の出典）
- `skills/SKILL.md` — `/trip` の標準手順（メイン）
- `skills/rules/{categories,date-rules,dedup-rules,fx-rules,tip-rules}.md` — 個別ルール
- `skills/templates/output-schema.md` — 列定義
- `.claude/commands/trip.md` — `/trip <slug>` のコマンド定義
- `.claude/agents/expense-extractor.md` — agent fallback 定義

新パターンに当たったときの調査順: `README §5` → `HANDOFF §4-5` → 個別 `skills/rules/*.md`。
