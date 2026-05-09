# triplog — 旅行収支自動化プロジェクト

Gmailの領収書メール（本文・添付PDF）から旅行収支を抽出し、
Google Spreadsheetに利用日昇順でTSV書き込みするためのClaude Code環境。

## 構成

- `.mcp.json` — Gmail / Google Sheets MCPサーバ設定
- `.claude/settings.json` — 権限設定（書き込み範囲制限・削除deny）
- `.claude/agents/expense-extractor.md` — 1メール→構造化JSONの抽出エージェント
- `.claude/commands/trip.md` — `/trip <slug>` コマンド
- `skills/` — ドメインルール集（チップ・重複排除・カテゴリ・FX等）
- `scripts/` — 決定的な正規化処理（dedup / tip-merge / fx / categorize / build-tsv）
- `trips/<slug>/config.json` — 旅行ごとの設定（spreadsheetId, sheetName, 期間 等）

## 使い方

```
/trip 2026-04-hawaii
```

詳細は `HANDOFF.md` を参照。

## 重要な制約

- 対象シート以外への読み書きは行わない
- 推測値で埋めない（不明は `null` または `※未取得`）
- 削除系MCP操作はsettings.jsonで deny 済み
- 書き込み前に必ずユーザーの明示的許可を得る
