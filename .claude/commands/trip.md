---
description: 指定旅行スラッグの収支を Gmail から抽出して対象シートに書き込む。書き込み前に必ず確認を取る。
argument-hint: <slug>
---

# /trip $ARGUMENTS

旅行スラッグ `$ARGUMENTS` の収支処理を一気通貫で実行する。

## 手順（必ずこの順序で）

1. `trips/$ARGUMENTS/config.json` を読み、`spreadsheetId` / `sheetName` / `period` / `queries` を取得
2. **`config.sheetName` 以外のシートには触れない**（読み取りすら避ける）
3. `mcp__gmail__search_emails` で `config.queries` を順に実行、messageId を集める
4. 各メッセージを `mcp__gmail__read_email` / `mcp__gmail__download_attachment` で取得し、`trips/$ARGUMENTS/raw/<messageId>.json` にダンプ
5. PDF添付は `pdf-parse` でテキスト化して同ディレクトリに保存
6. `@expense-extractor` サブエージェントで各 raw を `RawExpense` JSON に
7. `scripts/` を通して正規化:
   - `dedup` → `tipMerge` → `categorize` → `applyFx` → `applyDateRules` → `buildTsv`
8. `trips/$ARGUMENTS/output.tsv` を生成
9. **ユーザーに確認を取る**（書き込まない）:
   - 行数
   - カテゴリ別合計（円）
   - 対象シートの現在の `B19:I<最終行>` 範囲とその行数
   - 上書きされる範囲
10. ユーザーが明示的に「書き込んでOK」と承認したら `mcp__gsheets__update_cells` で `<sheetName>!B19:I<最終行>` を一括更新
11. 直後に同範囲を `mcp__gsheets__get_sheet_data` で読み返し、行数と合計が一致することを確認
12. 結果サマリ（書き込み済み件数、カテゴリ別合計）をユーザーに報告

## 厳守事項

- `config.sheetName` 以外のシートへの書き込み・クリア・削除は絶対禁止
- 推測値で欄を埋めない（不明は `null`、TSV化時は空欄）
- 確定日ベースの記録NG。必ず利用日
- ユーザーの承認なしに `update_cells` / `batch_update_cells` を呼ばない
- 詳細ルールは `skills/SKILL.md` と `skills/rules/*.md`

## エラー時

- Gmail/Sheets MCPの認証切れ → 「`npx @gongrzhe/server-gmail-autoauth-mcp auth` を実行してください」と案内
- 期間内にメール0件 → 検索クエリを表示し、ユーザーに修正を提案
- Folio PDFが取れない → その旨を明記し、宿泊行を `null`/`※未取得` で残してユーザー判断に委ねる
