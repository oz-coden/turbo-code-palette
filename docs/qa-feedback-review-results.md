# 手動QAフィードバック・Argon独立レビュー対応

2026-10-16、開発版0.0.1に対する検証記録です。製品は言語・用途非依存のSnippet / Pack管理ツールで、C# Provider / AtCoder Policyは任意です。
本書では人間による報告、コードからの確認、Host/API試験、未実施の実マウス試験を区別します。
旧QA runのlibrary・profile・報告書は変更しません。ライセンス・version・tag・公開方針も変更しません。

## A. 手動QAフィードバック

### 本人の結果と今回の対応

| 対象 | 本人の報告 | 今回の対応・再確認対象 |
| --- | --- | --- |
| Q01 | 達成 | 結果を保持。修正版VSIXは同じ0.0.1なのでhash / commitで区別し、隔離profileへ再インストール |
| Q02 | 達成 | 結果を保持。Selection作成の既存フローは維持 |
| Q03 | 達成、空file説明が不足 | New form内に空source作成とSave後の通常editor自動Openを説明。追加toastなし |
| Q04 | 達成、`test: test`の意味を質問 | 未知fieldは保持・raw表示するが解釈しない。合成fixtureでraw Save → Reload → 既知field編集 → Reload後の保持を検証 |
| Q05 | 実施できず、前提・QA Answerが不明 | tutorialとlabを分離して案内。QA Answer / QA Doubleの場所・内容、closureが2件になる期待結果、依存Remove拒否の意味を補足 |
| Q06 | 検索を進められない | Quick Pickの二重filterと条件候補絞込みを修正。Apply / Clear、条件追加と確定を分離 |
| Q07 | 手順と実UIが不一致 | 矢印は左クリック、Snippet名の右クリックはInsert submenuと明記。通常Insert / Mode / Optionsを区別 |
| Q08 | Escの意味不明、変換を確認できず | 出力pickerにCancelを追加、focus維持。tab CloseとCancelを区別。通常コメントが残る仕様と、実markerを生成して除去するpositive試験を追加 |
| Q09〜Q11 | 番号単位の結果は未報告 | 合格・不合格・実施済みを推測しない |
| Q12 | 達成、依存元を残す削除を拒否 | 結果を保持。既存の依存保護は維持 |
| Q13〜Q32 | 未報告 | 合格・不合格・実施済みを推測しない |

別途報告された「Pack作成 / Snippet追加」「Global copy」「target directory内へのExport」「Insert Undo」の成功も記録します。
これはQ09全体やImport往復、各mode等の完了を意味しません。

### 検索の根本原因と修正

以前はTCPが`pick.items`を更新した後に、native Quick Pickが入力queryとlabelをもう一度照合しました。
`Greeting`と一致しない`Apply filter (...)`が隠れ、複数条件の全queryとも一致しない次候補も隠れます。
さらにTCP独自のlast-token filterが、受理済みの`lang:...`等で他の種類の候補まで除いていました。

修正版はTCP側がqueryを解釈し、操作行・候補を公開APIの`alwaysShow`で保持します。
操作と条件をseparatorで分け、Applyをactiveに戻します。受理した条件は末尾空白で確定し、次のmodifierを選択可能にします。
`lang:`等の編集中modifierだけを候補補完に使い、quote内の空白もtokenとして保持します。
候補は現在のhitだけでなくロード済みcatalog全体から作り、各種類10件（編集中は30件）まで表示します。それ以上はmodifier prefixを入力して絞れます。
Clear searchはqueryだけを解除し、All / Favorites / Recentは独立です。不正queryは適用できません。

公開APIの根拠は同梱`@types/vscode`のQuickPickItem.alwaysShow / QuickPick.activeItemsです。
実マウスでの複合検索と発見性は本人による再試験が必要です。Host/APIの操作は実マウス検証と報告しません。

### Clean Copy・markerの保証範囲

| 組合せ | 現在の動作 |
| --- | --- |
| generic Readable / Competitive | proven TCP markerのみ除去。普通のcomment・whitespaceは保持 |
| generic Custom | 提供されるmarker transformのみ。通常 / XML comment除去はない |
| C# Roslyn Readable | syntax-aware marker除去 |
| C# Roslyn Competitive | marker + 証明可能なunused using + 安全なnormalization。普通のcomment除去はしない |
| C# Roslyn Custom | 通常 / XML comment等を利用者がcheckして選択。Source URL / notice / policy保護commentは残る |
| Selection | 元document全体の字句contextと完全pair包含を必要とする。全file向け変換は制限 |
| PolicyがAtCoder | 普通のcommentも安全側に保護。通常Presetとは独立 |

markerが最初からない、pairが不完全、string / markup等と区別できない場合は除去されません。
JS / TS / Pythonの既に安全と分かる位置にある独立line commentは、次行のcontextを汚染しないよう修正しました。
不確実なstring / block comment / JSX等から「回復」するscannerは追加していません。backslash、Unicode line separators、encoding / shebang等の保守的制限も維持します。
根拠は[Python lexical comments](https://docs.python.org/3/reference/lexical_analysis.html#comments)と[ECMAScript comments](https://tc39.es/ecma262/multipage/ecmascript-language-lexical-grammar.html#sec-comments)です。C / Java等へこの限定証明を流用しません。

generic Insert marker生成はSnippet本体のquotes / slash / angle brackets等で省略し得ます。
C#生成も既存の狭いgeneric経路のままで、Roslynを使うのはmarker検出・Clean除去です。ここを完全対応済みとは扱いません。
普通の全文Source URL / notice headerは、既存コードにquote / operatorがあるだけで失敗するわけではありません。prefix / Selection / 言語による制限を分けて検証しました。

出力pickerへtransform IDを表示し、明示的Cancelを追加しました。Previewは最終planそのもの、tab Closeは処理Cancelとは別です。
helper利用不可の理由はPreset picker内へ表示し、その案内だけのための追加modal通知は出しません。実際の変換失敗はerrorとして扱います。
Source URL・license noticeの収集 / 保護・原本非変更・Cancel時の非出力を維持します。

### 自己依存と未知metadata

依存候補から現在のUUIDを除外します。異なるlocation / versionでも同じUUIDなら自己依存候補にはしません。Pack member検索には影響しません。
Save拒否の報告は既定のversion constraintと整合しますが、調査ではconstraint省略時に自己参照が通る経路もありました。
今回の明示要件に合わせ、直接self-dependencyをmetadata validationで拒否します。一般の複数UUID間のcycle / SCCは維持します。
raw JSONの通常editor Save自体はvetoしません。不正self-dependencyはReload後の依存利用 / Insert / Import / structured Save等で拒否し、raw閲覧・修復を可能にします。

未知の`test` fieldはTCPの実行設定でも検索tagでもありません。原文のMetadata / unknown fieldsに出し、意味は解釈しません。
既知fieldの構造編集後も未知fieldと未知数値tokenを保持します。利用者がraw JSONから削除したfieldの復元はしません。
未知fieldもcontent fingerprintに含めるため、複数locationの同一revision間の未知field差異はConflict対象になります。

### 承認が必要な仕様提案

#### 繰返しSnippetと依存の重複防止

現状はroot / Template / dependencyのすべてにreceiptが作用します。rootの同一revisionが既存の検証済み全文snapshotにある場合は入力前にskipします。
外部編集後は、たとえbodyが見つかっても再利用を断定せず停止します。C#ではさらにsymbol / compilation検証があります。
この方針を今回のbug fixで変更していません。

| 案 | 利点 | 問題 |
| --- | --- | --- |
| すべてのrootを繰返し可、dependencyだけonce | 入力が増えない | metadataにexportsがないclass等もあり、rootの再定義を招く。言語非依存に自動判定できない |
| Snippetにrepeatable / onceを明示 | 一度だけ設定、Insertの追加dialog不要 | metadata / receiptsの区別が必要。既存defaultはonceを維持する必要がある |
| 重複ごとに確認dialog | その場で選べる | for文等の頻用で操作が増え、Conflictの安全な意味と混同しやすい |

推奨は**Snippet単位の明示repeatable、既定once維持**です。
repeatable rootのinstanceと依存用identity receiptを分離し、宣言exportsを持つもの・repeatableを依存先にするものは初版では制限する案です。
依存は従来どおりverified once、必要ならrootは依存を持てます。新metadataの意味を持つためasset revision更新規則とmigrationを定義し、承認後に実装します。

#### C#の異なるtargetsとsource管理

High-3のper-Snippet配置は、依存firstの仮想documentへ各自のtargetsで局所配置し、anchorを移動追跡し、最後に一つのcompilation検証と一括apply / Undoを行う案を推奨します。
全sourceの単純結合・targetsの和集合による推測は採用しません。
using scope / namespace binding / member context、receipt位置、C# marker生成のrangeをまとめて設計する必要があるため今回の共通target制限は維持します。
現行維持は安全ですがmode選び直しが必要、個別配置は元仕様に近い一方でplanの再設計と追加fixtureが必要です。
Sourceの個別Reveal / Add / Removeも初回仕様との差が残ります。現在の通常editor + 参照一覧を維持するか、明示file操作を追加するかを承認対象とします。

#### 通知

今回はNewの説明をform内に置き、Clean picker内へ情報を出すことでtoastを増やしていません。新しい通知設定は追加しません。

| 現在の種類 | 推奨する扱い |
| --- | --- |
| error、Conflict、stale、書込み / recovery失敗 | 常に見えるerror / warning。必要な確認を省略しない |
| policy強制・出典不足・license保持・依存warning | 操作に結び付けて表示。成功messageへ埋めてquietで消さない |
| Pack saved / Copied / Imported / already present | formのstatusまたは短いstatus barへ。設定でtoastを希望可能 |
| hint / 操作説明 | field / picker / 詳細に表示。通常toastを使わない |
| 詳細diagnostics | 必要時だけ明示表示。秘密情報・絶対pathを無加工でlog出力しない |

必要なら一つの`notifications: essential / all`設定を追加する案です。推奨defaultはessentialで、上2行は常に表示、通常成功のみ控えます。
既存成功message内のdependency warning等を分類し直してから導入し、黙って全通知を抑制しません。

#### AtCoder Policyの整理・移行

現在のPolicy条件・setting ID・時刻比較・強制URL・comment保護を緩和 / 削除していません。
pickerと設定説明で「URL強制、公開申告の開始前比較、comment保護、transform allowlist」を具体的に表示するだけです。

推奨は**通常のSource attributionとtransform保護を汎用Optionとして使う**運用です。Policy noneではcontest startを使いません。
将来は`attribution preservation profile`等へ、URLs required / preserve comments / protected notices / allowed transformsを明示して分離できます。
既存license保護は任意OFF可能にせず、v1に難読化transformを追加しません。
汎用profileをAtCoderの事前公開条件の検証・証明と呼ばず、コンテスト中のAI利用を許可する表示もしません。

日時setting撤去の移行案：旧AtCoder利用者はそのまま旧条件を維持し、初回の明示選択で「legacy policy継続」か「汎用出典profileへ切替」を選びます。
後者は日時申告の比較がなくなる意味変更であり、事前公開要件への適合を示さないことを確認してから適用します。
旧settingとmetadataのpublication / publishedAtは即削除せず、rollback / unknown preservationのため保持します。
設定UIからの撤去・policy名 / 意味・default変更は承認後に行います。

[指定された公式変更](https://github.com/atcoder/rules/commit/61500f0afb842798a5ab626725350059540bec04)の事前公開条件と、Source URL commentを付けることは別です。
現在アクセス可能なURLや自己申告日時だけを過去公開の証明にしません。TCPは提出適格性を認定しません。

## B. Argon独立レビュー

Argonの重要度・「確認済み」をそのまま採用せず、現行の[InsertionPipeline](../src/application/insertionPipeline.ts)、[CSharpClient](../src/language/csharpClient.ts)、[Engine](../csharp/Tcp.CSharp/Engine.cs)、UI・metadata・既存テストと照合しました。
元仕様の依存ごと設定と、[承認済みPhase 6の共通target制限](phase6-results.md)を区別しています。

| ID / 再評価 | 分類 | 根拠・再現条件 | 対応 | 追加検証 | 残留リスク / 制限 |
| --- | --- | --- | --- | --- | --- |
| High-1 / High | 確認された問題 | B挿入 → 無関係Xを構造挿入 / attribution付与 → B依存A。全文apply editが旧receiptと重なる | 構造配置を局所editで保持。headerは保守的な差分transitionを記録し、verified全文snapshotから無変更rangeを追跡 | JS / C#で連続3 Insert、Bは一度、notice / URL保持、一回Undo。触ったrange・duplicate body・外部編集は拒否 | 単独body一致でidentityを新規認定しない。広い書換えや不明変化は引き続きambiguous |
| High-2 / Mediumと能力制約 | 一部確認、一部過大 | JS / Pythonの普通の先行line commentでもscannerが停止。quote等のgeneric制限はPhase 6で明示。全文headerは普通のcodeでも成功し、Roslyn Cleanはsyntax処理 | JS / TS / Pythonのproven独立line commentだけ修正。string等の不確実状態からの回復なし。理由 / guide補足 | line comment後のmarker生成 / Clean、literal / markup / escapeの非除去、全文attribution、Roslyn comment / string / `<` / `>` | C# Insert marker生成のRoslyn化は未実装。genericのquote / operator等の制限は残る |
| High-3 / Medium、改行はbug | 確認された制限・仕様判断待ち。改行 / EOFは確認済bug | 異なるtargetsは意図的な共通target制限。元仕様より狭い。wrapper LFとEOF trivia境界も確認 | 異targetsは理由付き非変更停止を維持。EOL triviaをtargetに合わせ、literal tokenは保持。file-scoped namespaceのEOF境界を修正 | 異targetsでeditor / usage非変更、CRLF / raw literal、EOF comment / 空行、C#連続挿入 | per-Snippet配置は承認待ち。literal内のLFはデータとして残る |
| Medium-1 / Medium | 確認された問題、abort説明は一部過大 | lstat待ち後にdisposedを見ずspawn。cancelはstartingを無視。元コードもAbortSignalをspawn後に確認しkillするので永久放置の断定は過大 | startup generation、dispose / cancel / abortのspawn前確認 | 遅延lstatを注入した3 raceでchildなし。既存timeout / crash等も維持 | OSのstat自体の取消しは行わない。FS待ち完了後に拒否する |
| Medium-2 / High（未保存編集喪失） | 確認された問題 | Aのdirty form中にBをDeleteすると無条件panel.dispose | 対象 / 親Packが表示assetに関係するときだけ破棄確認・close。無関係form保持 | dirty token / instance保持、対象削除Cancelでasset維持 | 手動でtab Closeした際の保護は別のUI制約 |
| Medium-3 / Medium | 確認された問題、例のsymbolは誤り | nameを使う正しいexport行でnamespace / container / signature省略が効かない。symbolだけの行はinvalid | exports JSONを実際に編集した時だけ省略qualifierを削除。未変更formは非表示値も保持 | 省略削除、unknown数値token保持、Name-only Save、symbolだけの行を拒否 | 空文字はglobal namespace等の意味を持ち得るので省略と同一視しない |
| Low-1 / Low | 確認された問題 | 外部変更 → Later → 元bytesへ復元でpendingが残る | 内容復元でbadge / notification latchを解除。root変更 / read errorのsticky pendingはReloadまで維持 | 内容復元と再通知、root変更時のpending保持 | 自動Reloadはしない |
| Low-2 / 対象外 | 現行実装では誤認 | 指摘のcore/catalog/loader.ts、showSearch、tcp.searchは現行に存在しない | 3行制限の修正なし。現在のdetails previewを検証 | 5行目のsentinel表示、Open source in editor | previewは20 source、各100,000文字・合計300,000文字の上限。全文は通常editor |
| Verify-1 / 制限 | 仕様判断待ち、現在の拒否は意図的 | 元仕様のmay inferは義務ではなく、Phase 6ではexplicit targets必須と明記 | 推測fallbackを追加せず、説明と停止理由を明確化 | 明示targetの正常系、共通targetなしの非変更 | 新規C# Snippetにtargetsがなければstructure-awareは使えない |
| Verify-2 / UI gap | 仕様判断待ち、差は確認 | 元仕様の個別Reveal / Add / Removeがない。Openと相対既存source一覧のみ | 現在の制限をKnown Issues / 日本語guideへ明記 | normal editor source Open、非宣言path拒否、preview | file管理UI追加は承認待ち。Sources参照の解除と物理削除は別 |

## C. 検証結果

### ローカル結果（Windows x64）

| 検証 | 最終結果 |
| --- | --- |
| Unit / security rule tests | 150 / 150、skip 0 |
| Roslyn tests | 31 / 31 |
| QA preparation / fixture tests | 3 / 3 |
| Extension Host、VS Code 1.134.0 | 90 / 90 |
| Extension Host、VS Code 1.142.0 | 90 / 90 |
| VSIX隔離インストール / activation / JS create-search-Insert / packaged helper | 上記2 versionとも成功 |
| generated C# Bundle | 合成projectのdotnet compile成功、実行結果42 |
| typecheck / ESLint / production build | 成功（package:vsixのprepublishを含む） |
| Markdown / reference check | 10文書、44 local links、47 command title参照、14 settings参照。fences / whitespaceも成功 |
| VSIX audit | allowlist、secret / path、binary home-path検査成功 |

最終VSIXは`.vscode-test/turbo-code-palette-0.0.1.vsix`、21 entries、3,680,733 bytesです。
SHA-256：`4dd253ab33a0eadd2a779987e1d0967041daa725ad39a60c7c17d5be6045c19a`。
正式releaseではなく、再試験用0.0.1です。同versionなのでhash / commitで識別します。
インストール方法は[日本語開始ガイド](ja/README.md)を参照してください。個人profileへ自動インストールしていません。

新規unitは`src/test/unit/qa-feedback.test.ts`の10件とproduction webviewの1件、Hostは`src/test/integration/qa-feedback.test.ts`の10件、Roslynは3件です。
途中の失敗（native fuzzy選択、C# EOF境界等）は修正し、上の最終試験で再確認しました。
CIのmacOS最低対応版では、検索試験が固定150ms後にまだ入力反映前の9件を読んで失敗しました。試験はquery / active Apply / sidebar適用の条件を上限付きで待つ形に修正し、assertionを省略せず再検証します。製品codeやpackage内容はこの試験同期修正で変更しません。
最初の制限付き環境で既存link testが権限不足になった実行は合格に含めず、権限を得た再実行で全件確認しました。
このMarkdown確認は軽量checkerであり、full Markdownlint / 日本語校閲 / GUI確認そのものではありません。

### 変更範囲・Git / CI

- Application：search controller、insertion receipt lineage、Clean picker、delete panel lifecycle、metadata export patch。
- Core / Provider：receipt tracking、self-dependency検証、限定comment proof、C# startup race / placement EOL・EOF。
- UI：search picker、New / dependencyの説明、未変更exports JSONの保持。
- Tests：unit、production webview、Host、Roslynの回帰試験。
- Docs：本報告、日本語User Guide / Manual QA / Tutorial / index、過去準備結果への注記、Known Issues、参照checker。
- Settings：既存Policyの説明文だけ更新。setting ID / default / 強制条件 / license / versionは変更なし。

CIは既存の[Build and phase checks](https://github.com/oz-coden/turbo-code-palette/actions/workflows/ci.yml)を維持しています。
Windows / Linux / macOSのbuild-and-unit 3 jobsと、VS Code 1.134.0 / 1.142.0のHost + installed VSIX 6 jobsが対象です。
この変更のpush後の実結果・commit SHAはActionsの該当runと完了応答へ記録します。ローカルWindows結果を他OSの手動合格と読み替えません。
commit前にstatus / tracked files / diffとstaged + history security scanを確認し、生成VSIX・library・profile・logをcommit対象にしません。
既存QA run、Global / Workspace個人データの変更・削除、history rewrite / force push、release / tag作成は行いません。

現時点で未実施なのは、修正版の本人による全32項目、実クリック数・直感性、screen reader等です。
Host/APIのQuick Pick / editor / form検証は、それらの代替完了とは扱いません。
新しいQA runを作る場合も既存runを削除・初期化しません。
