# 日本語ドキュメント・手動QA準備の検証結果

対象：開発版0.0.1、2026-10-16。製品機能・version・licenseの変更はありません。
Marketplace公開・GitHub Release作成も行っていません。

## 作成した資料とデータ

- [開始ガイド](README.md)：VSIX生成、通常 / 隔離インストール、起動、更新・削除、データ保護。
- [ユーザーガイド](user-guide.md)：汎用基本操作を先に、C# / AtCoder等を応用へ分離。
- [チュートリアル](tutorial.md)：JSで11段階の実践、目安20〜30分。
- [手動QA](manual-qa.md)：優先順32項目。前提・操作・期待結果・結果 / click数 / keyboard数 / 発見性 / 復帰の欄。
- [不具合報告](bug-report.md)：再現情報と秘密情報・pathの伏字。
- `qa/fixtures`：2 Pack / 9 Snippetの合成library、通常JS / Python / HTML入力、C#追加例、初期状態へ混ぜないConflict variant。
- `scripts/prepare-manual-qa.mjs`：新規runのみ作成。tutorial / labのprofile・Globalを分離。起動 / download / install / 既存データ削除をしない。

実行時のlibrary、profile、report、archiveは`.vscode-test/manual-qa`配下でGit管理対象外です。
fixtureそのものだけをGit管理します。fixture URL / 公開日時 / noticeは合成データであり、実際の公開証拠やTCP本体のlicenseではありません。
コピーしたチェックリストの開始ガイドlinkはrepositoryの資料へ補正し、報告雛形はrun内の書込み用copyを開きます。そのlinkも準備テストで確認します。

## 照合した実装と説明上の注意

`package.json`のcommands / menus / settings、controllerのregistrationとpicker、
`detailsPanel.ts`と`palette-panel.js`のform、Insertion / Clean / archive / user state / Providerの実装を確認しました。

| 誤解しやすい点 | 現在の実装に合わせた説明 |
| --- | --- |
| Basic / Advancedという2 tab | 上部の基本fieldと、Advanced / optionalの折り畳み |
| Template / 出典 / noticeを専用formで設定 | 現在はOpen raw metadataのJSON編集 |
| Copyで任意の既存Packを選べる | Default Pack / New Packのみ。既存Packへの追加はPack編集Search / add |
| modeとOptionsを一つのdialogで選ぶ | Options操作はdefault mode。明示modeとの組合せはdefault settingsを使う |
| Untitledが最初のoutput pickerにある | Preview / Untitled documentから後続pickerでOpen Untitled document |
| RecentはInsert成功だけで増える | 詳細表示でもRecent更新。usage countだけが成功Insert限定 |
| generic Bundleは実行可能code | 明示選択と依存closureによるreview JSON |
| Conflictに一般的な自動Replaceがある | 停止 / Compare / 対応時New Version。Fork / 条件付きReplaceはPack Importの明示操作 |
| JS / Python / HTMLの構造挿入も推測対応 | genericのstructure-awareは明示plaintext fileのみ |
| source Saveでversionが上がる | Save → Reload → 明示metadata revision更新 |
| 任意のmarker候補を消せる | 証明できなければ保持 / warning。付加も安全でなければmarkerは省略 |

製品の新しい不具合修正は加えていません。上記の制約を隠す説明や未実装UIの案内を避けました。
既存英語ガイドのRecentの記述は成功Insert時の更新を説明しているだけで、詳細表示でも更新する点を明記していません。日本語ガイドで補っています。

## 実行した検証

| 検証 | 結果・実際の範囲 |
| --- | --- |
| `npm run check:docs` | 日本語資料等のローカルlink、正式TCP command title、setting ID、code fence・行末空白を検査 |
| `npm run test:manual-qa` | 3 / 3成功。既存run非上書き、空tutorial / Globalの分離、2 Pack / 9 Snippet読込み、依存first、literal Template、全Pack ZIP往復、不正ZIP拒否、意図的Conflict、Roslyn構造位置・semantic Bundle compile検証 |
| `npm run test:unit` | 既存139 / 139成功、skipなし。security・storage・version・Insert plan・Clean・helper障害等を含む |
| `npm run package:vsix` | 型検査・ESLint・production bundle、既存SDKによるhelper package、21 entryのVSIX監査成功 |
| `npm run test:installed -- 1.134.0` | Windows x64、隔離インストール成功。インストール済みartifactから起動、JS作成 / 検索 / Insert、同梱helper利用可をAPIで確認 |
| `npm run test:installed -- 1.142.0` | 同じくWindows x64で成功。実マウス・操作数の試験ではない |
| public repository scan / diff review | tracked / 新規source・fixture、history、staged内容を確認。個人path・credential・生成runを含めない |
| Git ignore | 実行時profile / `.snippets` / reportを無視することを確認 |

Markdown検査は依存追加のない軽量checkerです。完全なMarkdownlint / Markdown rendererによる見た目検証ではありません。
CIには既存検査を残したまま、docs / manual-QA fixture検査を追加しました。
Roslynの生成Bundleはhelperのstandalone compilation / Emitで検証しています。今回ユーザーprojectをbuildする処理は追加していません。

## 今回生成したVSIX

- 出力：`.vscode-test/turbo-code-palette-0.0.1.vsix`
- size：3,678,194 bytes
- SHA-256：`be87e95b665917e3afb046aae3fb5a80b27cc4b50c36906755e16d7ec6141d62`
- 日本語資料はrepository側で参照します。README / 英語ガイドからも案内します。
- fixture、QA設定、Global / Workspace実行データ、report、開発用sourceはVSIXへ混入していません。
- 同じversionでも再ビルドによりarchive hashが変わる場合があります。QAでは使用artifactのhashを記録してください。

## 未検証・本人確認が必要なこと

今回の日本語手順を**実mouse / keyboard / screen readerで通した結果は未記入**です。
click数、発見性、focus、errorからの復帰、file dialog、通常profileへの導入、更新 / アンインストールの最終確認は本人が行います。
Linux / macOSの今回の手動操作、Remote / WSL / Container、他architecture、runtimeが実際にない環境は未検証です。
既存Phase 7のplatform CI実績と、今回の手動QAを混同しません。

最初はtutorial、次にP0の非C#基本動作、P1のTemplate / 依存 / file / Conflict / Clean、最後にP2のoptional C# / Policy / 環境・accessibilityを推奨します。
合成URLをAtCoderの事前公開証拠として扱わず、実利用時の出典・公開事実・licenseは別途本人が確認してください。
この準備の完了は、正式release承認・license確定・Marketplace公開の許可を意味しません。
