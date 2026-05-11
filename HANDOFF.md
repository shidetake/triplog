# 旅行収支自動化プロジェクト 引き継ぎ資料

## 0. このドキュメントの目的
Chrome拡張版Claudeで開始した「旅行収支をGmailから抽出してGoogle Spreadsheetに記録する」タスクを、Claude Codeに引き継ぐための資料。
直近のハワイ旅行(2026-04-28〜2026-05-05)で得た知見を、再利用可能なSkill/プロジェクトとして実装することがゴール。
**まずプロジェクト雛形を構築 → そのプロジェクトを使ってハワイ分を再実行する** の順で進めてほしい。

---

## 1. ゴール

### 1.1 中期ゴール（プロジェクト構築）
旅行ごとに `config.json` を1つ書けば、
1. 期間内のGmailを横断的に検索・本文/添付取得
2. 重複排除・チップマージ・カテゴリ付与・FX換算を経て
3. 指定スプレッドシートの指定シートに、利用日昇順のTSVとして書き込む
までを `/trip <slug>` のような単一コマンドで完結させる。

### 1.2 直近ゴール（ハワイ旅行データの再実行）
作ったプロジェクトを使い、ハワイ2026-04旅行のデータを抽出し直して下記スプレッドシートに書く。
- spreadsheetId: `1QEUhnI0BQjfrSXbEmS5WjkGcLTYGXU9D3fNSe59cXV4`
- sheetName: `2026-04Hawaii`
- 期間: 2026-04-28 〜 2026-05-05
- 出発: 成田 / 滞在: ワイキキ / ホテル: Royal Hawaiian
- 主要決済手段: Sony銀行ドルデビット（USD直接決済、円確定額あり）+ クレカ + 現金少々

---

## 2. 重要な制約（厳守）

- **`2026-04Hawaii` シート以外は絶対に編集しない（読み取りすら極力避ける）**
- 同スプレッドシート内に他シートが多数あるが、**書き込みは対象シートのみ**
- 推測値で埋めない。不明は `null` または `※未取得` を残す
- 添付PDF（特にホテルFolio）の取得は必須要件
- ユーザーは利用日（実際に使った日）ベースの記録を望む。確定日ではない
- 削除系MCP操作は不要（`.claude/settings.json` でdeny推奨）

---

## 3. 出力スキーマ（既存シートに合わせる）

スプレッドシートのヘッダー行は18行目、データは19行目から。

| 列 | 名称 | 型 | 例 | 備考 |
|---|---|---|---|---|
| B | 日付 | YYYY/MM/DD | 2026/04/28 | 利用日 |
| C | カテゴリ | enum | 飲食 | 後述語彙のみ |
| D | 利用先 | string | Howzit Brewing | カード明細の生表記(`TST*`等)は使わない |
| E | 詳細 | string | IPA Pint, Loco Moco（チップ$12.06 / 18%） | メニュー名・商品名・移動区間など |
| F | 現地価格(USD) | number | 79.08 | 現地通貨での確定額（チップ込み） |
| G | レート | number or "BANK" | BANK | Sony銀行確定円額が取れたら "BANK" |
| H | 円(JPY) | integer | 11842 | 数式ではなく値で書く |
| I | 計算対象外 | boolean | FALSE | 集計除外フラグ |

詳細列(E)の方針：
- 飲食 → 注文メニュー + チップ情報
- 小売 → 購入商品名
- 移動 → 区間 + 時刻（例 "HNL空港→ワイキキ 8:26AM"）
- 宿泊 → 泊数・部屋種別・含まれる料金種別

---

## 4. 今回の旅行で学んだドメイン知見（必読）

### 4.1 チップルール
- 一番頻度が高いのは **20%**
- 次が **18%**
- 小額決済（おおむね$10未満）は **絶対額 $1 / $2 / $3** がよくある
- レシートが取れない場合の推定優先順位：20% → 18% → 22% → 15% → 絶対額
- 部屋付け（hotel folio経由）は通常チップ込みなのでこれ以上分解しない
- Uberはチップが事後追加されるのが普通。差分はそのまま `tipLocal`

#### 確認済みのチップ実例（ハワイ旅行）
- Howzit Brewing: 67.02→+12.06（=18%）, 25.13→+4.52（=18%）, 9.42→+$2, 9.42→+$1
- Village Bottle Shop: 29.32→+5.86（=20%）, 3.14→+$1, 2.62→+$1
- Star of Honolulu: 50→+5（=10%、ツアー系の例外）

### 4.2 重複排除
Sony銀行は「ご利用速報」と「ご利用金額確定」の両方を送ってくる。さらに店からのレシートメールもあり、最大3重複する。

マッチング条件（全部満たしたら同一取引）：
- マーチャント名の正規化（`TST*`, `SQ*`, `SP*`, `PAYPAL*` プレフィックス除去 → 大文字化 → 空白圧縮）一致
- 金額が ±25% 以内（チップ事後追加を考慮）
- 日時が ±72時間以内

採用優先順位（同一取引内の代表選定）：
1. hotel-folio
2. receipt-email / airline / rideshare
3. sony-bank-confirm
4. sony-bank-auth

### 4.3 確定追加（チップ）マージ
オーソリ→確定の差分はチップ。**確定額ベースの1レコードに統合**し、`tipLocal` に差額を保持。
レコードの `occurredAt` は **速報側の日付（=利用日）** を使う。確定日は使わない。

### 4.4 カテゴリ語彙（これ以外使わない）
`渡航` / `宿泊` / `現地移動` / `飲食` / `お土産` / `衣服` / `エンタメ` / `医療` / `カジノ` / `通信` / `その他`

※ `日用品` は廃止。スーパーは `飲食`、ドラッグストアは `医療`、雑貨店は `その他` 等、一番近いものに寄せる。

マッピングのコツ：
- レストラン・ブルワリー・バー・カフェ → `飲食`
- ホテル直接請求 → `宿泊`、ホテル内レストランの部屋付け → `飲食`
- ABC Stores等のコンビニは中身次第で `飲食` or `お土産`
- スーパー（Whole Foods, Waikiki Market 等） → `飲食`
- ドラッグストア（Longs, CVS, Walgreens 等） → `医療`
- 航空会社・空港バス・成田エクスプレス → `渡航`
- Uber/Lyft/タクシー → `現地移動`
- ツアー（Star of Honolulu等）・入場料 → `エンタメ`
- カジノ・ポーカールーム → `カジノ`

### 4.5 日付ルール
- 必ず利用日を使う。確定日NG
- 国際線：搭乗日が利用日。**往路=出発日、復路=出発日（到着日ではない）**
  - ハワイ復路：5/4出発、5/5到着 → 5/4で記録
- ホテル：チェックイン日に集約（日割りはしない）。ただし部屋付け（飲食・スパ等）は明細日付で個別行
- 並び順：利用日昇順 → 時刻昇順 → カテゴリの自然順

### 4.6 FX換算
- Sony銀行ドルデビットは円確定額が出る → そのまま採用、レート列は `"BANK"`
- それ以外（クレカ円建て等）は config の `fxRateOverride` か当日TTM
- JPYは整数円（四捨五入）、USDは小数2桁

### 4.7 ホテルFolio（特に注意）
Royal Hawaiianの場合、Folio PDFが添付メールで届くが、Chrome拡張では中身を読めなかった。
取得する必要がある内訳：
- 客室料金（1泊毎）
- Resort Fee
- 宿泊税：TAT（Transient Accommodations Tax）/ HCT（Honolulu County Tax）/ GET（General Excise Tax）
- 部屋付け請求（レストラン・ミニバー・スパ等）

部屋付け請求は **個別レコード（明細日付）として `飲食`等のカテゴリに振り分け**。
税金・客室料金部分は `宿泊` カテゴリで集約してOK。

---

## 5. Gmail検索クエリ集（実績ベース）
レシート全般
from:(no-reply OR receipt OR receipts) "$" after:2026/04/28 before:2026/05/06
Sony銀行
from:banking ご利用 after:2026/04/28 before:2026/05/07
from:banking ご利用金額確定 after:2026/04/28 before:2026/05/07
航空会社
from:deltaairlines receipt SASAKI
配車
from:uber.com receipt after:2026/04/27 before:2026/05/07
ホテル
Royal Hawaiian Folio
Halekulani Folio
Marriott Confirmation
包括検索
subject:(receipt OR confirmation OR folio) after:2026/04/28 before:2026/05/06

---

## 6. 推奨ディレクトリ構成
travel-expenses/
├── .mcp.json
├── .gitignore                     # node_modules/, dist/, trips//raw/, trips//output.tsv
├── README.md
├── HANDOFF.md                     # このドキュメント
├── .claude/
│   ├── settings.json              # 削除系deny、書き込み範囲制限
│   ├── agents/
│   │   └── expense-extractor.md   # 1メール→構造化JSON
│   └── commands/
│       └── trip.md                # /trip <slug>
├── skills/
│   ├── SKILL.md                   # メイン手順
│   ├── rules/
│   │   ├── categories.md
│   │   ├── tip-rules.md
│   │   ├── dedup-rules.md
│   │   ├── date-rules.md
│   │   └── fx-rules.md
│   └── templates/
│       └── output-schema.md
├── scripts/                       # 決定的処理はTS関数として実装
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── types.ts
│       ├── dedup.ts
│       ├── tip-merge.ts
│       ├── fx.ts
│       ├── categorize.ts
│       └── build-tsv.ts
└── trips/
└── 2026-04-hawaii/
├── config.json
├── raw/                   # Gmail本文・添付ダンプ（gitignore推奨）
└── output.tsv

---

## 7. MCP選定とセットアップ

### 7.1 必要なMCP
- **Gmail MCP**：候補 `@gongrzhe/server-gmail-autoauth-mcp`（OAuthが楽）
- **Google Sheets MCP**：候補 `mcp-google-sheets` 系。複数実装あり、`sheets_get_values` / `sheets_update_values` / `sheets_append_values` / `sheets_get_sheet_names` などが揃うものを選ぶ
- （任意）**Google Drive MCP**：FolioをDrive経由でOCRしたい場合

### 7.2 GCP側
1. GCPプロジェクト作成（`claude-personal` 等）
2. Gmail API / Sheets API / (任意で) Drive API を有効化
3. OAuth同意画面：External / Testing、自分のアドレスをテストユーザーに追加
4. スコープ：`gmail.readonly`, `spreadsheets`, `drive.file`（Drive使うなら）
5. 認証情報：Desktop appクライアント → JSONを `~/.config/gcloud/travel-expenses-oauth.json` に配置

### 7.3 .mcp.json（雛形）

```json
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": ["-y", "@gongrzhe/server-gmail-autoauth-mcp"]
    },
    "gsheets": {
      "command": "npx",
      "args": ["-y", "mcp-google-sheets"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "${HOME}/.config/gcloud/travel-expenses-oauth.json"
      }
    }
  }
}
```

### 7.4 .claude/settings.json（雛形）

```json
{
  "permissions": {
    "allow": [
      "Read(./**)",
      "Write(./trips/**)",
      "Write(./scripts/dist/**)",
      "Bash(npm:*)",
      "Bash(npx:*)",
      "mcp__gmail__*",
      "mcp__gsheets__sheets_get_*",
      "mcp__gsheets__sheets_update_values",
      "mcp__gsheets__sheets_append_values"
    ],
    "deny": [
      "mcp__gsheets__sheets_delete_*",
      "mcp__gmail__delete_*",
      "mcp__gmail__trash_*"
    ]
  }
}
```

### 7.5 初期認証
```bash
mkdir -p ~/.config/gcloud
cp ~/Downloads/oauth-client.json ~/.config/gcloud/travel-expenses-oauth.json
npx @gongrzhe/server-gmail-autoauth-mcp auth
```
※ Testing状態のままだとリフレッシュトークンが7日で切れる。自分専用なら都度再認証 or 本番公開（自己審査）に切り替え。

---

## 8. 初回タスク（Claude Codeへの依頼内容）

このドキュメントを読んだ後、以下の順で進めてほしい：

### Phase A: プロジェクト雛形作成
1. 上記ディレクトリ構成で空プロジェクトを作成（`~/projects/travel-expenses/`）
2. `.mcp.json`, `.claude/settings.json`, `.gitignore`, `README.md` を配置
3. `skills/` 配下のルール集とテンプレを、§4の知見をもとに具体的に書き起こす
4. `.claude/agents/expense-extractor.md` と `.claude/commands/trip.md` を作成
5. `scripts/` のTypeScript雛形（types/dedup/tip-merge/fx/categorize/build-tsv）を実装
6. `trips/2026-04-hawaii/config.json` を §1.2 の値で作成
7. `git init && git commit`

### Phase B: MCPセットアップ確認
1. ユーザーにGCP OAuthクライアント作成と `~/.config/gcloud/travel-expenses-oauth.json` 配置を案内
2. `npx @gongrzhe/server-gmail-autoauth-mcp auth` で認証
3. Gmail MCPの簡単な疎通確認（`gmail_search_messages "from:uber.com" maxResults:1` 等）
4. Sheets MCPの疎通確認（**読み取りのみ**で対象シートのヘッダー行を取れるか）

### Phase C: ハワイ分の本実行
1. `trips/2026-04-hawaii/raw/` にGmail検索結果と本文・添付PDFをダンプ
2. `expense-extractor` agent で各メールを構造化JSON化
3. `scripts/` の関数を通して正規化（dedup → tip-merge → categorize → FX）
4. `output.tsv` を生成
5. ユーザーに件数・カテゴリ別合計・対象シートの現在の状態を見せ、**書き込み許可を得てから**シートに反映
6. 書き込み範囲は `2026-04Hawaii!B19:I<最終行>`、I列は `FALSE` 明示

---

## 9. スプレッドシートの現在の状態

Chrome拡張セッションで一度書き込んだ62行が **既に入っている**。これは中途半端な状態（ホテル¥0プレースホルダ、Uber住所/レストランメニュー欠落）なので、**今回の再実行で全行上書きしてOK**。

書き込み前にユーザーに「`B19:I80` の現在の内容をクリアして上書きします」と必ず確認すること。

既存データの概要（参考値、再実行で正しく上書きされる）：
- 渡航: ¥637,800（Delta往復、Amex SafeKey経由）
- 飲食: ¥282,660
- 現地移動: ¥44,747
- 衣服: ¥35,414
- お土産: ¥20,488
- エンタメ: ¥15,657
- 宿泊: ¥0（Folio未取得）

合計（宿泊除く）: ¥1,036,766

---

## 10. 既知の未解決事項（Phase Cで解消すべきもの）

1. **Royal Hawaiian Folio PDF の中身**
   - 客室料金 / Resort Fee / TAT / HCT / GET / 部屋付け請求の内訳を取得
   - PDF添付がGmail MCP越しに `getAttachments` 相当で取れるはず。バイナリ取得→pdf-parse等でテキスト化
2. **Uberメールの乗降地と時刻**
   - Chrome拡張ではメール本文に到達できなかった
   - Gmail MCPなら本文取れるので、`Pickup` / `Drop-off` 行を抽出して詳細列(E)に「住所A→住所B HH:MMAM」形式で
3. **レストラン詳細メニュー**
   - Halekulani Orchids / Hana Koa Brewing / Hula Grill / Yard House / Island Vintage Wine Bar
   - レシートメール本文から注文項目を抽出
4. **Uber確定額の差し替え**
   - 5/4のUber：オーソリ$28.98 → 確定$29.05 のような速報/確定差分が他にもあるはず。確定優先で上書き

---

## 11. 出力スキーマ詳細（再掲＋例）
2026/04/28	渡航	JR成田エクスプレス	東京→成田空港	0.00	1	3070	FALSE
2026/04/28	渡航	Delta DL182	NRT→HNL ビジネス	2126.00	BANK	318900	FALSE
2026/04/28	現地移動	Uber	HNL空港→ワイキキ 8:26AM	28.45	BANK	4263	FALSE
2026/04/28	宿泊	Royal Hawaiian	7泊 オーシャンビュー (Resort Fee/TAT/HCT込)	5234.78	BANK	784550	FALSE
2026/04/29	飲食	Howzit Brewing	IPA Pint, Loco Moco（チップ$12.06 / 18%）	79.08	BANK	11842	FALSE

書き込みは `mcp__gsheets__sheets_update_values` で `2026-04Hawaii!B19:I<n>` を一括更新。

---

## 12. このドキュメントを受け取ったClaude Codeへの最初の指示（コピペ用）

> 以下のHANDOFF.mdを読み込み、まずPhase A（プロジェクト雛形作成）を実施してください。
> §6のディレクトリ構成と§7のMCP設定、§4のドメイン知見を `skills/rules/*.md` と `scripts/src/*.ts` に正確に反映させること。
> Phase A完了時点で一度成果物を見せて、私の確認を得てからPhase Bに進んでください。
> Phase Cでスプレッドシートに書き込む際は、書き込み内容（件数・合計・対象範囲）を必ず提示し、明示的な許可を得てから実行すること。
> 対象シート（`2026-04Hawaii`）以外への読み書きは絶対禁止です。
