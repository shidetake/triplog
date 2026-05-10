# triplog — 旅行収支自動化プロジェクト

Gmail の領収書メール（本文・添付 PDF）から旅行収支を抽出し、Google Spreadsheet に利用日昇順で書き込むための Claude Code 環境。

`/trip <slug>` 1コマンドで「Gmail 検索 → ノイズ除去 → raw ダンプ → 決定的パース → agent fallback → 正規化 → output.tsv → 承認 → シート書き込み」までを通す。

---

## 1. 構成

```
triplog/
├── .mcp.json                            # gmail / gsheets MCP
├── .claude/
│   ├── settings.json                    # 権限・削除deny
│   ├── agents/expense-extractor.md      # LLM fallback agent
│   └── commands/trip.md                 # /trip <slug>
├── skills/
│   ├── SKILL.md                         # メイン手順
│   ├── rules/{categories,date-rules,dedup-rules,fx-rules,tip-rules}.md
│   └── templates/output-schema.md
├── scripts/
│   ├── package.json                     # google-auth-library, pdf-parse
│   ├── src/
│   │   ├── types.ts                     # RawExpense / RawMessage / TripConfig
│   │   ├── filter.ts        / filter-cli.ts   # ノイズ除去
│   │   ├── parsers/
│   │   │   ├── route.ts                 # ソース判定
│   │   │   ├── util.ts                  # 日付・FX・全角→半角・HTMLストリップ
│   │   │   ├── sony-bank.ts             # 利用通知 / 確定通知
│   │   │   ├── toast.ts                 # toasttab.com
│   │   │   ├── square.ts                # messaging.squareup.com
│   │   │   ├── uber.ts                  # noreply@uber.com（日本語Subject）
│   │   │   └── marriott-folio.ts        # PDF folio
│   │   ├── extract.ts                   # 決定的パース → extracted.json + needs-agent.json
│   │   ├── dedup.ts                     # 重複排除（fuzzy prefix一致 + 25%/72h）
│   │   ├── tip-merge.ts                 # auth+confirm の差分 = チップ
│   │   ├── categorize.ts                # 10カテゴリ語彙
│   │   ├── fx.ts                        # JPY 換算（BANK / 固定レート）
│   │   ├── build-tsv.ts                 # TSV 出力
│   │   ├── cli.ts                       # `npm run pipeline <slug>`
│   │   └── auth-sheets.mjs              # Sheets MCP の初回 OAuth
│   └── scratch/                         # subagent 経由の Gmail ダンプ用ヘルパ
│       └── save-raw-stdin.cjs           # mcp__gmail__read_email 出力 → RawMessage JSON
└── trips/<slug>/
    ├── config.json                      # 旅行ごとの設定
    ├── raw/                             # gitignore（messages/kept/extracted/needs-agent/<id>.json）
    └── output.tsv                       # gitignore
```

---

## 2. 新しい環境でのセットアップ

### 2.1 GCP OAuth クライアント
- Gmail API / Sheets API / Drive API を有効化
- OAuth 同意画面: External / Testing、自分のアドレスをテストユーザーに追加
- スコープ: `gmail.readonly`, `spreadsheets`, `drive.file`
- 認証情報: Desktop app → JSON を `~/.config/gcloud/travel-expenses-oauth.json` に配置

### 2.2 Gmail MCP 認証
```bash
mkdir -p ~/.gmail-mcp
cp ~/.config/gcloud/travel-expenses-oauth.json ~/.gmail-mcp/gcp-oauth.keys.json
npx @gongrzhe/server-gmail-autoauth-mcp auth
```

### 2.3 Sheets MCP 認証（注意: `mcp-google-sheets@2.0.1` は対話的 OAuth フローを持たないので独自スクリプトでトークン発行）
```bash
cd scripts
npm install
npm run auth:sheets    # ブラウザが開く → 承認 → ~/.config/gcloud/triplog-sheets-token.json
```

### 2.4 Claude Code 起動
このディレクトリで Claude Code を起動。`.mcp.json` が `gmail` と `gsheets` を立ち上げる。

---

## 3. 旅行を1つ処理する

### 3.1 旅行設定を書く
`trips/<slug>/config.json` を新規作成:

```json
{
  "slug": "2026-08-okinawa",
  "spreadsheetId": "...",
  "sheetName": "2026-08Okinawa",
  "headerRow": 18,
  "dataStartRow": 19,
  "writeRange": "B19:I",
  "period": { "start": "2026-08-01", "end": "2026-08-07" },
  "primaryStay": "Halekulani Okinawa",
  "queries": [
    "from:(no-reply OR receipt OR receipts) \"$\" after:2026/08/01 before:2026/08/08",
    "from:banking ご利用 after:2026/08/01 before:2026/08/09",
    "from:banking ご利用金額確定 after:2026/08/01 before:2026/08/09",
    "from:noreply@uber.com after:2026/07/31 before:2026/08/09",
    "subject:(receipt OR confirmation OR folio) after:2026/08/01 before:2026/08/08"
  ],
  "noiseFilters": {
    "fromDomains": ["note.com", "noreply@github.com", "..."],
    "subjectPatterns": ["メルマガ更新", "Welcome to ", "..."]
  },
  "fxRateOverride": null
}
```

### 3.2 `/trip <slug>` を実行
Claude Code 内で `/trip 2026-08-okinawa` と入力。手順は `.claude/commands/trip.md` 参照。書き込み前に必ず確認が入る。

---

## 4. 直近のドッグフーディング（2026-04 ハワイ）の状態

シート `2026-04Hawaii!B19:I81` に **63 行** を書き込み済み（合計 **¥605,651**）。

カテゴリ別:
| カテゴリ | 行数 | ¥ |
|---|---|---|
| 渡航 | 2 | 160,680 |
| 宿泊 | 1 | 55,464 |
| 現地移動 | 6 | 22,425 |
| 飲食 | 37 | 258,292 |
| お土産 | 7 | 32,403 |
| 衣服 | 2 | 35,354 |
| エンタメ | 4 | 8,144 |
| 日用品 | 3 | 30,889 |
| 通信 | 1 | 2,000 |

---

## 5. 既知の不具合・残件（次セッションへの引き継ぎ）

### 5.1 ハワイ旅行データの欠落
- **往路 Delta（NRT/HND→HNL, 2026-04-28）が抽出できていない**: `from:deltaairlines SASAKI` と `subject:Flight Receipt SASAKI` のいずれでも往路 receipt が見つからない（return のみ存在）。HANDOFF.md §9 ベースだと往路 ¥318,900 が不足。**対応案**: 別ベンダー（Delta Vacations / 旅行代理店）の receipt を別クエリで探すか、AmEx 明細を別系統から手動入力。
- **Halekulani Orchids ランチ $314.27 / ¥47,141**: 抽出データに該当無し。AmEx 直接決済で電子レシートを受信していない可能性。Sony 銀行通知にも該当 merchant が無い。**対応案**: AmEx 明細を別経路で確認、または手動 1 行追加。
- **Star of Honolulu**: $5（chip auth）のみシートに入っている。$50 base auth が取りこぼされた。**対応案**: Sony 銀行の `STAR OF HONOLULU` 通知をすべて再パースし、tip-merge を強化。

### 5.2 Sony 銀行 JPY が emails に出ない問題
HANDOFF.md §4.6 では「Sony 銀行ドルデビットは円確定額が出る → そのまま採用、レート列は `BANK`」と記載されているが、**実メールの「ご利用金額確定のお知らせ」も USD 表記のみで JPY を含まない**。
- 現状の妥協: `config.fxRateOverride: 149.75` を固定で使い、Sheet の `レート` 列は固定値表示
- **本来やるべき**: 公開 API（みんかぶFX、JMA等）から日次 TTM レートを取りに行く `scripts/src/fx-fetch.ts` を実装、または Sony 銀行 web/PWA から JPY を吸い上げる経路を探す

### 5.3 dedup の取りこぼし
- **Sony 銀行のチップ専用 auth が単独行で残る**（例: `SQ *HOWZIT BREWING $4.52`、`SQ *VILLAGE BOTTLE SHO $2.62`、$1, $2 など 7 行）。これらは親 receipt 行のチップに合算すべき。
- **対応案**: `tip-merge.ts` を「同マーチャント・近接時刻（72h）の小額単独 auth は親に吸収」するモードに拡張。現状は `sony-bank-auth + sony-bank-confirm` ペアしか扱わない。
- **NALU HEALTH BAR が同日に 2 行**: 別訪問の可能性もあるが要確認。

### 5.4 パーサ未対応のレシート形式
needs-agent.json に落ちた / 手動追加した形式（`trips/2026-04-hawaii/raw/agent-fallback.json` 参照）:
- **Delta** (`DeltaAirLines@t.delta.com`): 平文 receipt。`parsers/delta.ts` を書けば自動化可能。
- **Yard House** (`receipt@ziosk.com` Ziosk 端末): タブ区切り風 plain text。
- **UNIQLO** (`ml.store.uniqlo.com`): plain text、商品名+価格列が綺麗。
- **Alo Yoga** (`aloyoga.com`): plain text + EMV PDF 添付。
- **Clover** (`@clover.com`): 簡素な plain text（合計のみ、明細なし）。MONI/NALU/KAI/TUTU で利用。
- **Stripe (Ubigi)** (`receipts+...@stripe.com`): 平文、JPY 直接決済。
- **Marriott Folio PDF**: 現パーサは `MM/DD/YY` 区切り想定だが、実フォーマットは `DD-MMM-YY<reference><description><amount>`（区切り文字なし）。**現状は手動展開**で `agent-fallback.json` に書き込んだ。`parsers/marriott-folio.ts` のレギュラ式を「日付直後に reference (数字 or `RT`/`AX` 等)、続いて description、最後に amount.dec」で書き直せば自動化可能。

### 5.5 ノイズフィルタの育成
`config.noiseFilters` は旅行ごとに上書き可能だが、**共通で使い回したいデフォルトリスト** が欲しい。`skills/templates/default-noise-filters.json` を作って `config.json` で `extends` できるようにする案。

### 5.6 期間外メールの取りこぼし
旅行直前/直後に届く receipt（ホテル予約確定、航空券事前購入、Folio はチェックアウト後送付）は `period` の単純な日付フィルタでは漏れる。たとえば Delta 往復 receipt は **2025-11-29 発行**で `period.start` の半年前。
- **対応案**: `queries` に **航空会社・ホテル名は期間外も検索** する旨を `config.json` 例に書く（既にハワイの config では `Royal Hawaiian after:2026/04/27 before:2026/05/15` で半月幅にしているが不十分）。

### 5.7 expense-extractor agent と deterministic パーサの重複
agent fallback は今回 15 件中 13 件を「手動でその場で JSON を書く」方式で処理した。本来は agent に messageId を渡して並列実行する設計だが、small fallback set なら main で書く方が速い。
- **対応案**: SKILL.md に「fallback < 20 件なら main で extract、それ以上なら agent」のガイドを書く。

### 5.8 download subagent の context 浪費
1回の subagent invocation で 109 件のメールを処理しようとすると、Uber/Toast の 60KB HTML が context に積み上がって途中で予算切れする（実際 33/109 で停止した）。
- 当面の対策: Sony 銀行（小サイズ）と HTML（大サイズ）を別 subagent で並列処理する。**今回はこの方式で最後まで通った**。
- 根治: `scripts/scratch/save-raw-stdin.cjs` を skill のメイン手順に組み込み、auto-save 経由で常に disk-to-disk で流す。

### 5.9 Uber 日本国内乗車のカテゴリ判定
旅行初日/最終日に **日本国内** で Uber に乗る場合（自宅→駅、空港→自宅 など）、これは `渡航` か `現地移動` か曖昧。今回は「渡航と一連の動線」と解釈して `渡航` にしている（HANDOFF.md §11 の `JR成田エクスプレス` 例に倣う）。
- **明文化**: `skills/rules/categories.md` に「旅行日付の出発前/到着後の domestic 移動 = 渡航」を追記。

---

## 6. 主要ドキュメント

- `HANDOFF.md` — Chrome 拡張時代の引き継ぎ資料（ドメイン知見・チップルール・カテゴリ語彙の出典）
- `skills/SKILL.md` — `/trip` の標準手順
- `.claude/commands/trip.md` — `/trip <slug>` の実行手順サマリ
- `skills/rules/*.md` — チップ・重複排除・カテゴリ・FX・日付ルール

## 7. 重要な制約

- 対象シート（`config.sheetName`）以外への読み書きは絶対禁止
- 推測値で欄を埋めない（不明は `null` または空欄）
- 削除系 MCP 操作は `.claude/settings.json` で deny 済み
- 書き込み前に必ずユーザーの明示的許可を得る
- 確定日ベースの記録 NG（必ず利用日）

## 8. ライセンス

個人利用のみ。Anthropic / Marriott / Delta / Sony Bank / Uber / Toast / Square / Clover 各社のサービス利用規約に従うこと。
