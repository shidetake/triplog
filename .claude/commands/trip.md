---
description: 指定旅行スラッグの収支を Gmail から抽出して対象シートに書き込む。書き込み前に必ず確認を取る。
argument-hint: <slug> [--reuse-raw | --force-refetch]
---

# /trip $ARGUMENTS

旅行スラッグ `$ARGUMENTS` の収支処理を一気通貫で実行する。詳細手順は `skills/SKILL.md` を参照。

引数の最初のトークンが slug、残りはオプション扱い:

- 既定: `trips/<slug>/raw/` に未除外の `<messageId>.json`（meta系を除く）が存在すれば**自動で reuse-raw モード** に入り、Gmail を叩かない（手順3スキップ）
- `--reuse-raw` を明示しても同じ
- `--force-refetch` を付けた場合のみ、raw を保ったまま手順3を再実行（既存の raw は上書き）

## 手順サマリ

1. `trips/$ARGUMENTS/config.json` を読み、`spreadsheetId` / `sheetName` / `period` / `queries` / `noiseFilters` を取得
2. **`config.sheetName` 以外のシートには触れない**（読み取りすら避ける）
3. **(reuse-raw 時はスキップ)** Gmail 取得フロー
   - `mcp__gmail__search_emails` で `config.queries` を順に実行、`{messageId, from, subject}` 集合を作る
   - `scripts/src/filter.ts` の `applyNoiseFilters()` で `config.noiseFilters` に従いノイズを除去（落としたものは `trips/$ARGUMENTS/raw/filtered-out.json` に保存）
   - 各メッセージを `mcp__gmail__read_email` / `mcp__gmail__download_attachment` で取得し、`trips/$ARGUMENTS/raw/<messageId>.json` にダンプ（PDF は `pdf-parse` でテキスト化して `RawMessage.attachments[].textContent` に格納）。件数が多い場合は **download 用のサブエージェント**（general-purpose）に委譲して main context を保護
4. **Square enrichment**: `trips/$ARGUMENTS/raw/<messageId>.json` を全件走査し、`from` が `messaging.squareup.com` でかつ `linkedContent` が未設定のもの全てを対象に、本文中の `https://squareup.com/r/<hash>` を `WebFetch` する。プロンプトは「`<qty> <name> $<price>` 形式の品目行のみを返す。subtotal/tax/tip/total/payment 行は除外」。返ってきた文字列を `RawMessage.linkedContent` として raw JSON にマージ保存（既存フィールドは破壊しない）
5. `npm run extract $ARGUMENTS` で deterministic パーサを通す（Sony bank / Toast / Square / Uber / Marriott Folio）
   - 出力: `trips/$ARGUMENTS/raw/extracted.json` と `trips/$ARGUMENTS/raw/needs-agent.json`
6. `needs-agent.json` の各メッセージを `@expense-extractor` サブエージェントで `RawExpense` 化し、`extracted.json` に追記
7. `npm run pipeline $ARGUMENTS` で `dedup → tipMerge → categorize → applyFx → buildTsv`
8. `trips/$ARGUMENTS/output.tsv` を生成
9. **ユーザーに確認を取る**（書き込まない）:
    - 行数
    - カテゴリ別合計（円）
    - 対象シートの現在の `B19:I<最終行>` 範囲とその行数
    - 上書きされる範囲
    - reuse-raw で動かしたか / Gmail を再取得したか
10. ユーザーが明示的に「書き込んでOK」と承認したら `mcp__gsheets__batch_update_cells` で **B19:F<最終行> と H19:I<最終行> の2範囲** を一度に更新（**G列はシート側の formula `=IF(ISBLANK($F),"",$H/$F)` で auto 計算されるので絶対に書かない**。JPY 通貨の行は F を空文字、H に円額のみ）
11. 直後に同範囲を `mcp__gsheets__get_sheet_data` で読み返し、行数と合計が一致することを確認
12. 結果サマリ（書き込み済み件数、カテゴリ別合計）をユーザーに報告

## 厳守事項

- `config.sheetName` 以外のシートへの書き込み・クリア・削除は絶対禁止
- **G 列（レート）には絶対に書き込まない**（シート側の formula が壊れる）。書き込みは `batch_update_cells` で B:F と H:I の2範囲に分ける
- **JPY 通貨の行は F 列も空にする**。H にだけ円額を書く
- 推測値で欄を埋めない（不明は `null`、TSV化時は空欄）
- 確定日ベースの記録NG。必ず利用日
- ユーザーの承認なしに `update_cells` / `batch_update_cells` を呼ばない
- reuse-raw モードでも Square enrichment（手順4）は必ず実行する。WebFetch の結果は raw JSON を破壊しないようにマージ書き込みすること（既存フィールドの保持）
- 詳細ルールは `skills/SKILL.md` と `skills/rules/*.md`

## エラー時

- Gmail/Sheets MCP の認証切れ：
  - Gmail: 「`npx @gongrzhe/server-gmail-autoauth-mcp auth` を実行してください」
  - Sheets: 「`cd scripts && npm run auth:sheets` を実行してください」
- 期間内にメール0件 → 検索クエリを表示し、ユーザーに修正を提案
- Folio PDF が取れない → その旨を明記し、宿泊行を `null`/`※未取得` で残してユーザー判断に委ねる
- パーサが新しい未対応フォーマットに当たった → `needs-agent.json` 経由で agent fallback で吸収。後で skill にパーサ追加を提案
- Square WebFetch が 404/expired → linkedContent は未設定のまま残し、detail 空欄で続行（ログに残す）

## ドッグフーディングで覚えた落とし穴

- Sony 銀行の **「ご利用金額確定」メールにも JPY は載らない**（USD のみ）。HANDOFF.md §4.6 と矛盾するため、JPY は FX 換算で出す前提で運用
- **Square のメール本文は URL のみ**。品目を埋めるには手順4の WebFetch enrichment が必須
- **Toast の `Total` は本文内で `Subtotal` の後に出る** ので `\b` 境界付きで抽出（toast.ts 参照）
- Uber は日本語 Subject ("Uber の領収書") なので `from:noreply@uber.com` で引く（"receipt" キーワード非該当）
- Halekulani は宿泊ではなくレストラン（Orchids）として引っかかる
- Marriott Folio は本文ではなく PDF 添付に内訳がある
- detail 列にチップ・タックス情報は入れない（user 指示: 情報量0なので不要）
