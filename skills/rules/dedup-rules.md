# 重複排除ルール

## なぜ必要か

Sony銀行は同一決済について

1. 「ご利用速報」（オーソリ時点）
2. 「ご利用金額確定」（確定後）

の両方を送る。さらに店からのレシートメールが届くと **最大3重複** する。

---

## マッチング条件（全部満たしたら同一取引）

1. **マーチャント名の正規化が一致**
   - プレフィックス除去： `TST*`, `SQ*`, `SP*`, `PAYPAL*`, `SQU*`, `WPY*` 等
   - 大文字化
   - 連続する空白を1つに圧縮
   - 末尾の店舗番号・州コード（例: `#1234 HONOLULU HI`）は曖昧マッチに含めてOKだが、別店舗判定もありうるので住所違いは別扱い
   - **fuzzy 一致の3段階**:
     1. 完全一致
     2. prefix / suffix 一致（長さ6以上）
     3. **単語集合の包含**: 短い側が2語以上で、その単語が全部長い側に含まれる
        - 例: `ISLAND VINTAGE WINE` ⊂ `IVWB ROYAL HAWAIIAN ISLAND VINTAGE WINE BAR` → merge
        - 例: `ABC #31` vs `ABC #78` → 単語集合が違うので merge しない
2. **金額が ±$0.10 以内**（絶対値）
3. **日時が ±72時間以内**

旧来は ±25% 相対許容で「auth はベース額 / receipt はチップ込み」の差を吸収していたが、
`mergeSonyAuthConfirmByApproval` で auth + confirm を承認番号ベースで pre-merge する仕様に
変更したため、cross-source dedup ではほぼ完全一致を期待してよい（同店舗で同額・近時刻の
別取引、HOWZIT $10.42 vs $11.42 等を誤マージしないため厳しめに）。

3つすべて満たさない場合は別取引として扱う。

### 同 source × 異 messageId は別ルール

同じ source（receipt-email × receipt-email、sony-bank-auth × auth など）で messageId が異なる場合は **「Gmail の重複コピー」のときだけ merge** する。条件全て:

- 金額完全一致（±$0.01）
- 時刻 1 分以内
- detail がコンフリクトしない（両方非空で異なれば別取引、Delta の HIDETAKE / NAE 等を区別）
- notes がコンフリクトしない（Sony 銀行の承認番号、Delta のチケット番号等で別取引判定）

これで Uber が同一トリップを 2-3 通受信するケースは merge し、同店舗・近額・短時間内の別注文（HOWZIT $10.42 の Hawaiian Time WC IPA / $11.42 の Howzit Light など）は別レコードとして残せる。

### Sony 銀行の auth + confirm を承認番号で pre-merge

Square 等は店内決済時に「ベース額」、ユーザーがチップを後で追加した時に「チップ額」を別決済として走らせる。Sony 銀行はそれぞれ別メールで届くが、**両方に同じ承認番号** が振られる:

- `sony-bank-auth`: ベース（チップ前）
- `sony-bank-confirm`: チップ部分のみ

dedup の前段で `mergeSonyAuthConfirmByApproval()` が動き、`notes` 内の `承認番号:XXX` が一致するペアを確定的に統合する（金額演算や receipt の有無に依存しない）。統合後のレコード:

- `amountLocal` = auth + confirm
- `tipLocal` = confirm.amount
- `occurredAt` = auth.occurredAt（速報側 = カード利用日）
- source / messageId / merchantRaw は auth のものを引き継ぐ

receipt-email がある場合は後段の dedup が cross-source で統合（受領 detail を取り込む）。receipt 無しの auth+confirm ペアもそのまま単独行として正しい合計を保持できる（Village Bottle $2.62+$1=$3.62 等）。

承認番号が無い旧パターン（auth と confirm で confirm に最終額が載るタイプ）は post-dedup の `tipMerge()` が引き続き拾う。

---

## 採用優先順位（同一取引内での代表選定）

優先度高 → 低：

1. `hotel-folio` — 内訳が最も詳細
2. `receipt-email` / `airline` / `rideshare` — マーチャント直接、メニュー情報含む
3. `sony-bank-confirm` — 確定額があるが内訳なし
4. `sony-bank-auth` — オーソリ、暫定値

代表に選ばれたレコードに対して、下位レコードからの情報をマージする：

- 確定額（`amountJPY`）は `sony-bank-confirm` から
- 内訳・詳細（`detail`）は上位から
- `occurredAt` は **速報側（=利用日）** を使う。確定日は使わない

---

## 実装上の注意

`scripts/src/dedup.ts` で `RawExpense[]` → `RawExpense[]` の純関数として実装。
グルーピングのキーは「正規化マーチャント名 + 日付ウィンドウ」でバケット化し、
バケット内で時刻と金額の近さでさらに分割する。
