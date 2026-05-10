---
description: 指定旅行スラッグの収支を Gmail から抽出して対象シートに書き込む。書き込み前に必ず確認を取る。
argument-hint: <slug>
---

# /trip $ARGUMENTS

旅行スラッグ `$ARGUMENTS` の収支処理を一気通貫で実行する。詳細手順は `skills/SKILL.md` を参照。

## 手順サマリ

1. `trips/$ARGUMENTS/config.json` を読み、`spreadsheetId` / `sheetName` / `period` / `queries` / `noiseFilters` を取得
2. **`config.sheetName` 以外のシートには触れない**（読み取りすら避ける）
3. `mcp__gmail__search_emails` で `config.queries` を順に実行、`{messageId, from, subject}` 集合を作る
4. `scripts/src/filter.ts` の `applyNoiseFilters()` で `config.noiseFilters` に従いノイズを除去（落としたものは `trips/$ARGUMENTS/raw/filtered-out.json` に保存）
5. 各メッセージを `mcp__gmail__read_email` / `mcp__gmail__download_attachment` で取得し、`trips/$ARGUMENTS/raw/<messageId>.json` にダンプ
   - PDF 添付は `pdf-parse` でテキスト化して `RawMessage.attachments[].textContent` に格納
   - 件数が多い場合は **download 用のサブエージェント**（general-purpose）に委譲して main context を保護
6. `npm run extract $ARGUMENTS` で deterministic パーサを通す（Sony bank / Toast / Square / Uber / Marriott Folio）
   - 出力: `trips/$ARGUMENTS/raw/extracted.json` と `trips/$ARGUMENTS/raw/needs-agent.json`
7. `needs-agent.json` の各メッセージを `@expense-extractor` サブエージェントで `RawExpense` 化し、`extracted.json` に追記
8. `npm run pipeline $ARGUMENTS` で `dedup → tipMerge → categorize → applyFx → buildTsv`
9. `trips/$ARGUMENTS/output.tsv` を生成
10. **ユーザーに確認を取る**（書き込まない）:
    - 行数
    - カテゴリ別合計（円）
    - 対象シートの現在の `B19:I<最終行>` 範囲とその行数
    - 上書きされる範囲
11. ユーザーが明示的に「書き込んでOK」と承認したら `mcp__gsheets__update_cells` で `<sheetName>!B19:I<最終行>` を一括更新
12. 直後に同範囲を `mcp__gsheets__get_sheet_data` で読み返し、行数と合計が一致することを確認
13. 結果サマリ（書き込み済み件数、カテゴリ別合計）をユーザーに報告

## 厳守事項

- `config.sheetName` 以外のシートへの書き込み・クリア・削除は絶対禁止
- 推測値で欄を埋めない（不明は `null`、TSV化時は空欄）
- 確定日ベースの記録NG。必ず利用日
- ユーザーの承認なしに `update_cells` / `batch_update_cells` を呼ばない
- 詳細ルールは `skills/SKILL.md` と `skills/rules/*.md`

## エラー時

- Gmail/Sheets MCP の認証切れ：
  - Gmail: 「`npx @gongrzhe/server-gmail-autoauth-mcp auth` を実行してください」
  - Sheets: 「`cd scripts && npm run auth:sheets` を実行してください」
- 期間内にメール0件 → 検索クエリを表示し、ユーザーに修正を提案
- Folio PDF が取れない → その旨を明記し、宿泊行を `null`/`※未取得` で残してユーザー判断に委ねる
- パーサが新しい未対応フォーマットに当たった → `needs-agent.json` 経由で agent fallback で吸収。後で skill にパーサ追加を提案

## ドッグフーディングで覚えた落とし穴

- Sony 銀行の **「ご利用金額確定」メールにも JPY は載らない**（USD のみ）。HANDOFF.md §4.6 と矛盾するため、JPY は FX 換算で出す前提で運用
- Square のメールは合計しか出ない（チップ・明細は full receipt URL 必要）
- Uber は日本語 Subject ("Uber の領収書") なので `from:noreply@uber.com` で引く（"receipt" キーワード非該当）
- Halekulani は宿泊ではなくレストラン（Orchids）として引っかかる
- Marriott Folio は本文ではなく PDF 添付に内訳がある
