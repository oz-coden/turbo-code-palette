# Turbo Code Palette v1 — 初回設計・実現性レビュー

レビュー日: 2026-10-08（日本時間）。対象は提供仕様書、既存リポジトリ、公式VS Code API、ローカルの`@types/vscode@1.134.0`。

初回レビューの提案を保持し、承認後の修正を追記した設計文書。現在の実装状況は[Phase 1結果](phase1-results.md)、優先するUX決定は[明示Insert方針](insertion-ux-policy.md)を参照。提供仕様書内のInitial Codex Promptは履歴として保存し、その後の利用者指示が優先する。

## 1. 判定: GO WITH NOTES

言語非依存のSnippet/Pack管理、挿入、ZIP入出力、基本Clean Copyは実装可能。承認済みの基本UXは「editorで位置を選ぶ → Snippetを検索/選択 → Insertを実行」。

着手前に以下の扱いを確認する。

1. **明示Insertを優先し、一覧はnative TreeViewにする。** 一覧button・右クリック・Command Palette/keyboard・Pack詳細のSnippetは共通Insertion pipelineへ接続する。詳細とmetadata formはWebviewにする。D&Dは無効でも主要機能が成立する補助機能。追加改修が必要なら廃止を検討し、未知の競合やVS Code干渉が生じたら積極的に廃止する。Webview D&D/raw fallback/非公開APIによる通常dropの追求は行わない。
2. **Pack自己完結性とWorkspace優先の適用場面を分ける。** 既存Pack内の依存はそのPackから解決する。Workspace → Globalは候補選択と新Pack/コピーの依存閉包構築に使う。別Packから黙って不足を補い、不正Packを隠さない。
3. **高度C#操作はRoslynに委譲する。** regexによる構造挿入、unused using削除、意味的Bundleは安全な代替にならない。基本TCPを.NET非依存で先に完成させる。

初回レビュー時にはAPIの型のみを確認していた。その後のPhase 0実Host実証と追加UX調査は完了・承認済み。実マウスとprovider直接呼出しの証拠は分けて結果文書に記録する。

## 2. リポジトリ評価

開始時はGit初期化済み、commitなしの`master`、remoteなし。指定GitHubへの`git ls-remote`は成功し、公開された参照はなかった。未追跡の既存ひな形を初回commitとして保存し、初期branchを`main`、指定URLを`origin`に設定した。

| 項目 | 確認結果 |
| --- | --- |
| `src/extension.ts` | Hello Worldコマンドのみ。TCP製品機能は未実装 |
| `src/test/extension.test.ts` | 配列のサンプルassertのみ。extensionの振る舞いを検証していない |
| `package.json` | version `0.0.1`、VS Code `^1.134.0`、`main: dist/extension.js` |
| build | TypeScript strict、Node16 module、ES2022、esbuild CJS bundle |
| check/test | ESLint、型チェック、VS Code test CLI/Electron構成 |
| docs | README/CHANGELOG/quickstartは生成ひな形 |
| release | `.vscodeignore`あり。CI、publisher、ライセンス方針、VSIX検証は未整備 |
| assets | 既存Snippet/Pack/user dataなし |
| local tools | Node `26.4.0`、npm `11.17.0`、node_modulesあり、.NET SDK `10.0.102`あり |

`npm run compile`（型・lint・bundle）と`npm run compile-tests`は成功。GUIを起動する`npm test`は未実行。`dotnet --info`はSDKを表示したがsandbox内のサービス管理アクセスでエラーも出た。C# helperのbuild/起動成功を示す結果ではない。

既存構成は継続利用する。最低対応VS Codeは暫定`1.134.0`を維持し、Phase 0で最低版/現行版の実runtime検証を設定する。APIの導入版だけでengineを引き下げない。初期対象はdesktopのworkspace extension。ブラウザー版は対象外、Remoteはhost側Global storageとして別途検証する。既存実装の制約はほぼなく、製品設計を阻むものはない。

## 3. VS Code API・UX監査

### 3.1 各操作の実装経路

TCP Activity Bar containerにSnippets/PacksのTreeViewを置く。Clean Copy/Settingsは小さい操作viewまたはtoolbarから開く。設定の実体はVS Code configuration、favorite等はMementoへ保存する。[公式Workbenchガイド](https://code.visualstudio.com/api/extension-capabilities/extending-workbench)

| 要望 | API/方式 | 限界・注意 |
| --- | --- | --- |
| sidebar/container | `contributes.viewsContainers` / `views` | ユーザーのview移動を妨げない |
| 一覧 | `TreeDataProvider` / `createTreeView` | label/description/tooltip/icon。HTMLの複数行cardは不可 |
| 詳細/metadata form | `createWebviewPanel` | panel参照を1つ再利用して`reveal`/内容更新。dispose時に参照解除 |
| Insert submenu | `submenus` / `view/item/context` | modeに応じた表示と実行時の再検証 |
| Pack詳細のSnippet | Webview Insert button/context menu | 同じInsertionPlannerを使う。D&DはPack tree内のSnippet行から提供 |
| multi-select | `TreeViewOptions.canSelectMany` | bulk操作は選択集合全体で依存検証。複数D&Dは延期 |
| search/filter | toolbarのQuickPick/QuickInput | modifier/metadata候補補完後、treeを絞る |
| 常設検索欄 | WebviewViewで自作 | TreeView標準findは独自modifier検索APIではない。初期はQuickInput |
| source open | `openTextDocument` / `showTextDocument` | 通常editor。binaryをtext扱いしない |
| OS reveal | `revealFileInOS` | URI/Remote環境によって利用不可の場合あり |
| VS Code Explorer表示 | `revealInExplorer` | workspace外Globalを表示できるとは限らない |
| raw metadata | 通常editor / read-only仮想document | future formatへTCPは書き込まない。手動raw編集は利用者の明示操作 |
| conflict compare | `vscode.diff` | metadata/sourceごとに既存diff editorを使う |
| watcher | `createFileSystemWatcher(RelativePattern)` | Globalも監視。外部変更は通知、Reloadまでsnapshot維持 |
| clipboard | `env.clipboard.writeText` | 元documentを変更しない |
| temporary output | untitled document / extension temp | 元source URIに保存しない |
| ZIP | host側Node library | Pack専用ZIP APIはない |
| terminal/Git | `createTerminal` / 固定processと引数 | metadata文字列をshell commandに連結しない |

メニューは[Contribution Points](https://code.visualstudio.com/api/references/contribution-points#contributes.menus)、native listは[Tree Viewガイド](https://code.visualstudio.com/api/extension-guides/tree-view)、open/diffは[Built-in Commands](https://code.visualstudio.com/api/references/commands)を確認した。

WebviewにはCSP、nonce付きlocal script、限定`localResourceRoots`、HTML escape、validated messageを使う。unknown metadataも詳細/rawで表示するが、HTML/commandとして実行しない。[Webviewガイド](https://code.visualstudio.com/api/extension-guides/webview)

### 3.2 D&Dの正確な境界

ローカル`node_modules/@types/vscode/index.d.ts`で、`TreeDragAndDropController.handleDrag`、`dragMimeTypes`、`registerDocumentDropEditProvider`、`dropMimeTypes`を確認した。tree→editorの経路として`text/uri-list`（CRLF区切りURI）が明記される。`provideDocumentDropEdits(document, position, dataTransfer, token)`は実drop位置を渡し、`DocumentDropEdit.insertText`と`additionalEdit: WorkspaceEdit`で別位置/別fileの編集も計画できる。[公式API](https://code.visualstudio.com/api/references/vscode-api#TreeDragAndDropController)

Phase 0試作:

1. Snippet行のdragで短命token付き`tcp-snippet:` URIを`text/uri-list`へ渡す。絶対source pathや全文をpayloadにしない。
2. TCP DropEditProviderはそのscheme/tokenだけを受理してindexのassetと照合する。他のURIを横取りしない。
3. 対象document/version、drop position、asset fingerprintを共通InsertionPlannerへ渡す。
4. structure-aware/EOFは空`insertText`+`additionalEdit`で目的位置へ入れる。Undo単位、同offset editの合成、provider候補選択を実runtimeで確認する。
5. provider計算中にdocument/filesystemを変更しない。cancel/未入力template/conflict/stale documentではTCP editを返さない。仮想URIを開くfallbackはread-only source previewとし、不完全なcode挿入へfallbackしない。

`editor.dropIntoEditor.enabled`が必要。通常dropとShift-dropを検証して必要な操作を案内する。設定を勝手に変更しない。URIの`L3,5`fragmentは参照元位置であり挿入先ではない。任意objectの`DataTransferItem.value`やcustom MIMEが全経路を通るとは仮定しない。Webview DOMのdragをnative controllerと同等には扱わない。別window/hostへtokenを持ち越さない。

drop APIにselection rangeは渡されないため、replace-selectionは明示Insertのみ。defaultがそのmodeならdropからInsertへ案内し、cursorへ黙って切り替えない。template/candidate入力は共通処理へまとめ、providerが繰り返し呼ばれてもtoken/document versionに結び付く短命plan cacheで二重promptを防ぐ。未選択providerに副作用がないことも合格条件。

成立しない環境ではInsert/キーバインドを提供する。試作不合格なら大きなUI実装の前に制約と代案を報告する。

## 4. open metadata・schema監査

### 4.1 lossless model

`MetadataDocument`は原文、token/AST、diagnostics、named-field semantic view、format状態を持つ。typed objectを丸ごとserializeする方式は使わない。`jsonc-parser`等のrange editingでknown pathだけ更新し、unknown nested fieldsを保持する。形式はstrict JSONのまま（JSONCを新仕様として導入しない）。

unknownの巨大numberを`JSON.parse`で丸めて書き戻さない。未編集subtreeは原文/tokenで保持する。重複JSON keyは曖昧なので診断しstructured edit/importを拒否、raw閲覧は許す。最低semantic validationはid/name/versionとSnippet sources。optional known fieldの型不一致は該当機能を停止し、unknown fieldを禁止しない。dependency/exports等を使用する時は必要な子fieldを検証する。favorite/recent/countはraw metadataと独立したuser state。

| formatVersion | 方針 |
| --- | --- |
| missing / 0 | best-effort、Legacy表示。明示Upgrade前に自動保存しない |
| 1 | named fieldを検証して通常操作 |
| >1 | 安全なfield/sourceの表示のみ。structured write/意味依存の挿入を止める |
| 不正型/負数 | diagnostics/raw表示。write/insert停止 |

Upgradeはメモリーで変換後、temp siblingへ書き、元fingerprint再確認後に置換する。failureで原本維持。future formatのbyte copy/exportは可能だが依存修復はしない。手動raw編集をTCPが完全禁止できるという意味ではない。

`formatVersion`はTCP metadata schemaのrevision、`version`はSnippet/Packのasset revisionであり独立する。意味を保持したmigrationはformatVersionだけをin-place更新でき、asset version増加や全copy同時更新を要求しない。source、意味論、依存関係等のassetの意味が変わるmigrationだけ通常のasset version更新規則を適用する（レビュー承認時の修正）。

物理treeのintegrity hashとassetのsemantic fingerprintを分ける。対応format間をlosslessなsemantic viewへ変換し、schema表現だけの差とformatVersion自体をasset conflictから除外する。unknown fieldsは保持しsemantic比較から勝手に除外しない。対応できないfuture formatは意味の同一性を推測せずread-onlyで扱う。migrationの実装と同一性テストはPhase 1で行う。

### 4.2 content/identityの定義案

- UUID構文検証、比較時lowercase正規化。rawは勝手に書き換えない。
- SHA-256 integrity fingerprint: metadataのobject key順/空白を無視、array順/unknown fieldを保持。stringは値で比較、unknown numberは原文tokenなので`1`/`1.0`の差を保持する。asset conflictには上記のformat非依存semantic fingerprintを使い、意味不変migrationの表現差をconflict扱いしない。
- Snippet contentはmetadataとfolder内の全regular file（README/LICENSE等も）のrelative pathとbyte hash。改行差もcontent差。asset内の`.git`、symlink、junction等は拒否。
- Packはmetadataと全Snippet/その他fileのtree fingerprint。外側folder名、scope、mtime、user stateを含めない。`pack.json`へcanonical member一覧を追加しない。
- 同UUID/version/hashはlogical cardへ集約して全location表示。hashが違えばconflict group、黙って挿入しない。
- 1Pack内は同Snippet UUIDの複数versionを禁止する案。異なるPack revisionは別folderで共存。compiled Bundleに同名異実装を無理に入れない。

フォームでcontentを変更する場合はversion増加必須。通常source editorはmetadata versionを自動変更しないため、外部Reloadで観測できる同revisionの変化を警告してnew version/forkへ案内する。比較対象のないsingle copyの過去変更まで検出できるとは約束しない。

Default Packは最初の書き込みで作成し、空workspaceを開いただけで`.snippets`を生成しない。Defaultへの追加/削除もPack変更で、transaction内でrevisionを進める（初期案は末尾patch増加）。exportはその時点のrevisionを保存する。

### 4.3 schemaの曖昧さを解く案

| 論点 | 提案 |
| --- | --- |
| `sources`と`source` | 実装path配列 / 出典link object配列。formは用途名で表示 |
| `category`単数 | v1は単一category、複数分類はtags |
| `usage[]`等の曖昧な要素型 | 任意JSON arrayとして表示、必要になるまで閉じた型を強制しない |
| linkのurl/path両方 | 2つの明示actionを表示。path基準はそのSnippet/Pack folder |
| license noticeのpreserve等 | v1意味はtextのみ。他属性から挙動を推測しない |
| legacy version表記 | best-effort表示、明示Upgradeで修正。黙ってnormalizeしない |
| source encoding | copyはbyte保持、insert時はtarget EOL。初期textはUTF-8、binaryはtextへ変換しない |
| multi-root | folderごとに`.snippets`。対象editorのfolder優先、残る曖昧さは選択。write先明示 |
| workspaceなし | Globalを利用可能、Copy to Workspaceは無効 |

## 5. version・dependencies

canonical version案は`v`+非負整数3成分+optional `-patch`。各成分のleading zeroは0自体以外禁止し、`.`はliteral、全体anchor。`V`、符号、SemVer prerelease/build、余分な空白は拒否する。BigIntで比較、DoS防止にcomponent長32桁の初期上限。

比較はmajor/middle/minor/patch。missing patchは`-0`より低いsentinelとし、`v1.2.3 < v1.2.3-0 < v1.2.3-1 < v1.2.4`。仕様未指定の`-0`を独立revisionとして保持する提案。

constraintは`= > >= < <=`+canonical versionの空白区切りAND。`>=v1.2.0 <v2.0.0`は有効。裸version、空string、`^`/`~`、OR/comma、余剰tokenは拒否。version key省略のみany。矛盾rangeはempty matchとして診断し、条件を緩めない。

resolverはdiamond dependencyに備えbacktrackingで全range交差を満たす。「最新を順番に1つずつ選ぶ」だけでは足りない。

1. dependency id/name必須、version optional。UUIDで解決、name差はwarning。
2. 明示root Snippet/version/locationを固定。identical cardのlocation選択はWorkspace優先。
3. 既存Pack操作はそのPackの内部で解決。不足/競合は停止。
4. 新Pack/独立copyの閉包はWorkspace適合候補のversion降順、次にGlobal適合候補の降順。各UUIDに対する全constraintを満たすよう探索。
5. 同scope/UUID/versionのcontent conflict等はcandidate UI。identical copyはprompt省略。Workspaceに不適合しかなければ適合Globalを使える。
6. 適合なしはmissing/unsatisfiable。近いversionを提案しても勝手に置換しない。
7. SCCへ縮約してdependency-first出力。SCC内はUUID/version/pathの安定順。循環を警告してもcode順の意味は保証しない。
8. 完成Packの全依存の物理的存在を再検証。bulk copy/deleteは集合全体で判定。

探索のnode数/時間/深さに上限とcancel。planはlocation/hash/warningsを保持しapply直前に再検証する。残るSnippetから削除対象へのdependencyがあればdelete拒否。不要に見えるdependencyも自動削除しない。copyは原本を残し、Snippet先はDefault/new Pack、Packは全体copy。

## 6. insertion・templates

`plan → collect inputs → validate → apply`で、依存/source/template/provider配置を計画してから一括適用する。previewも同じplan。途中で部分挿入しない。

| mode | v1方針 |
| --- | --- |
| cursor | 汎用textを指定位置へ |
| end-of-file | document末尾へ |
| replace-selection | 明示Insertのみ、selectionを事前capture |
| merge-sources | sources順のtext結合。意味的mergeは言語providerへ |
| separate-files | workspace内指定folderへ相対pathを保持して作成。既存file上書きなし |
| structure-aware | reliable providerがある時だけ。不可能なら代替modeを明示選択 |

denied優先→allowed→provider能力。default不正は診断し選択、unknown mode/targetを推測しない。sourceOverridesはv1は保持/表示のみ、未対応として警告。

各dependencyのmodeを使うが、複数replace-selectionなど重複rangeは停止。同offset insertは順序付き1editへ合成。Insertは最後の有効text editorのURI/version/selection、dropは渡されたdocument/positionを使い、Webview focus後のactiveTextEditorを信用しない。

template名はcase-sensitive `[A-Za-z_][A-Za-z0-9_]*`を提案。全sourceで同名は1回入力、異なるSnippetの同名は別input。重複定義、不正options/default、requiredの空値は診断。required=false/defaultなしは明示空文字を許可、未定義placeholderはrequired。置換は1pass literalで`$&`等を特別扱いしない。置換後の残存placeholder検査に失敗、cancel、stale状態ならeditor/file無変更。literal placeholderを残すescape構文はv1未定義。

二重挿入はplan内UUID/version集約、既存marker、C#のsymbol/内容照合で防ぐ。markerなし任意言語の既存コードを確実に判別できるとは約束しない。名前一致だけで依存を省略せず、疑わしい場合previewへ。hidden provenance DBは作らない。

## 7. 内部アーキテクチャ

coreはVS Code/DOM/process非依存。application serviceがplanとtransactionを仲介し、UIはfilesystemへ直書きしない。

```text
src/
  extension.ts                       lifecycle / composition root
  core/
    metadata/{document,semantics,format}.ts
    assets/{identity,fingerprint,conflicts}.ts
    version/{parser,constraint}.ts
    dependency/{resolver,graph}.ts
    search/{query,rank}.ts
    template/substitution.ts
    insertion/{modes,planner}.ts
    clean/{pipeline,presets,bundle}.ts
  application/
    {createSnippet,editMetadata,packEditor,copy,delete,importExport}.ts
  storage/
    {roots,discovery,safePaths,transactions,watcher,archive}.ts
  language/
    provider.ts
    genericProvider.ts
    csharp/{client,protocol}.ts
  state/userState.ts
  ui/
    {snippetTree,packTree,searchInput,detailsPanel,metadataForm}.ts
    {commands,dropProvider,conflictPicker,cleanCopyPanel}.ts
  integration/git.ts
  test/{unit,integration,fixtures}/
media/                               icons / local webview assets
csharp/Tcp.CSharp/                   optional Roslyn helper
docs/                                schema / security / user guide
```

Globalは設定rootまたはglobalStorageUri配下、Workspaceは各folderで同じloaderを使う。storageはURIを基本に必要なlocal Node操作だけ限定する。Remoteのworkspace extensionはremote hostで実行され、Globalもhost側になる。virtual read-only workspaceのwriteは制限する。[Remote公式ガイド](https://code.visualstudio.com/api/advanced-topics/remote-extensions)

LanguageProviderにはcapabilities、detectExports、planPlacement、detectAvailableExports、findBundleReferences、cleanを設けunsupported/ambiguousを返せるようにする。user stateはlogical UUID/version基準でmetadataと独立。watch snapshot/index/UI stateを分離する。

search queryはquoted valueを扱うtokenizerで分け、`lang:`、`tag:`、`category:`、`pack:`、`scope:`、`version:`、`author:`、`feature:`を認識する。候補補完はindex中の実metadataから生成する。name完全一致 → prefix → partial → tags/category → features → descriptionの順にrankし、同rankではWorkspace → Global、version降順、最後に安定したUUID順。検索なしもscope/version順にする。unknown modifierや不正version filterは診断して、黙って全件へ緩和しない。

marker挿入はVS Code設定で切り替え、known UUID/versionの専用commentを言語providerで生成する。未対応言語へC#形式のcommentを強制しない。markerを省略しても普通のproject codeであり、元Snippetとの同期は行わない。

## 8. archive / filesystem security

`.tcp-sp`は通常ZIP、rootの`pack.json`は1つ。reader候補はstreamingの[yauzl](https://github.com/thejoshwolfe/yauzl)、writer候補は[yazl](https://github.com/thejoshwolfe/yazl)。entry size validationを利用してもアプリ側のpath/累積size/metadata検証は必要。

entry検証:

- absolute、`..`、空component、drive relative/absolute、UNC、backslash、NUL/control、colon/Windows ADSを拒否。URI percent decodeしない。
- Windows reserved name、末尾dot/space、case-insensitive destination重複、duplicate entry、file/directory衝突、曖昧なUnicode衝突を拒否。
- symlink/hardlink相当、junction/reparse、device/nonregular entryを拒否。ZIP external mode情報も検証。
- encrypted/unsupported/破損ZIP、CRC不一致、宣言と実size差、重複JSON key、malformed JSON、missing source、unsafe sources/reference pathを拒否。
- 初期上限案: 10,000 entries、1file 16 MiB、解凍合計128 MiB、metadata 1 MiB、JSON nesting 64、path 240文字。compressed/実stream bytesとratio/timeを制限する。
- unknown JSON fieldは有効。`__proto__`等もraw dataとして扱い、unsafe object mergeしない。
- Pack内のduplicate UUID/複数version、不一致hash、依存閉包の欠落を検証。既存rootとのconflictはpreviewへ。

source open/copy/delete/export/separate-filesにも共通safePathsを使う。文字列prefixでなくcanonical root/relative pathでcontainment検証、ancestorのsymlink/reparse確認。別processのhostileな同時差し替えを完全防御できるとは主張せず、再検証/exclusive create/短いcommit区間を使う。

transaction:

1. destinationと同filesystemにUUID付きprivate stagingを作る。既存Packへ直接extractしない。
2. 全entryを検証してexclusive write。cancel/errorならstagingだけを処分。
3. 完成treeを共通loaderで読み、metadata/identity/dependency/hashを再確認。
4. additions/identical/version coexistence/conflictsのpreviewを表示。明示確定前にrootを変更しない。conflictは既定停止。
5. destinationを再確認し、1Packをrenameでcommit。atomic renameのないproviderはwrite制限か回復journalを使い制約を明示。
6. multi-Packは全planをjournalへ記録、再起動時に残存を検出。単一renameで全Packがatomicになると約束しない。

replaceはdiffと明示選択後、旧copyをrollback用に保持して成功後除去。staging/journalをdiscoveryから除外するがユーザーのgitignoreを変更しない。exportもtemp ZIPからdestinationへ移す。

local referenceはasset内に限定。通常external linkはhttp/httpsのみでcommand/javascriptを実行しない。importでasset scriptを自動実行しない。Git/helperはtrusted workspaceで固定executable/引数を使う。[Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust)

## 9. C# providerの選択

| 方式 | 評価 |
| --- | --- |
| VS Code symbol/reference commands | 軽いがC# extension/projectに依存。document symbolsは完全ASTではなく、referencesはsymbol位置が既知の時のAPI。未解決exportの解析を全部代替しない |
| 他extensionのLSPへ直接接続 | 安定した共通公開契約なし。非公開C# Dev Kit/OmniSharp実装へ依存しない |
| regex/軽量scanner | text操作には使えるがraw/interpolated string、preprocessor、namespace等で誤る。意味依存の操作には不採用 |
| 小さいRoslyn helper | syntax/semantic modelを利用できる。runtime/配布/参照assembly管理が必要。高度機能の推奨案 |

Roslynのsyntax treeとsemantic modelを使う。[Syntax分析](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/get-started/syntax-analysis)、[Semantic分析](https://learn.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/get-started/semantic-analysis)

拡張所有process、stdin/stdout JSON、stderr logs、protocol version/request ID/cancel/timeout/size上限。任意workspaceのMSBuild targetやgeneratorを実行しない。current documentと選択Snippet、明示reference assemblyに限定し、workspace build systemを作らない。

- exportsは候補自動検出後ユーザーが確認。unknown kindを保持。
- placementはsyntax nodeから近い合法targetを選び、file-scoped/block namespace、type/member、top-level、using位置を区別。parse error/曖昧さはpreview/選択。
- collisionはnamespace/container/signatureも確認。markerだけで実装互換を断言しない。
- Bundleはcurrent file参照→known exports→metadata依存閉包。曖昧nameは選択、未解決はdiagnostic。
- using/namespace/top-levelをsyntaxとしてmerge。同名異実装、partial不足、preprocessor条件不明で停止。単純連結を意味的Bundleと呼ばない。
- unused using削除は十分なcontextで証明できる時だけ。初期は残す。

runtimeなしでも基本TCPを使える。framework-dependentかOS別self-containedかは後述の製品判断。ローカルSDKの存在から全利用者へ.NETを必須化しない。

## 10. Clean Copyの安全なv1 subset

preview/clipboard/新規document/選択output fileへだけ出す。原本URI、alias path、symlink経由原本をoutputとして拒否。原本を加工してUndoで戻す方式にしない。

| 区分 | v1範囲 / 条件 |
| --- | --- |
| 全言語 | 無変換copy、preview、license text付加。TCP marker除去はcomment位置を安全に判定できる言語だけ |
| C# syntax | ordinary/XML comment除去。string/raw literal、directive、disabled text、token separatorを保持 |
| C# syntax | 安全な空行縮約/whitespace整形。raw literalの中身をtrimしない |
| C# Bundle | 必要Snippet閉包の収集・mergeとdiagnostics/preview |
| 延期 | unused class/using、local rename、modifier短縮、aggressive minify/golf |

Readableは対応言語の専用marker除去とnotice保持。CompetitiveはC# parserがある時にcomment/XML doc除去と安全な空行縮約を追加。Customは対応transformを選べる。parserなしでregexへfallbackしない。

licenseNotices[].textは収集/dedupし安全な対象言語commentとして出力。C#はline comment化して`*/`等をcodeへ漏らさない。directive順を守る。既定保持、設定に従う。preserve等の自由属性を推測しない。

空行/indent除去はPythonやraw string等に意味があるので「言語非依存で安全」ではない。非対応言語は無変換copyを確実に提供する。

## 11. 段階的実装計画

各phaseは責務単位のまとまりでcommit/pushし、acceptance結果を報告する。Phase 1完了後はPhase 2へ自動で進まない。下記fileは予定。

### Phase 0 — scaffoldとD&D実証

技術実証後の調査は[D&D UX追加調査](dnd-ux-investigation.md)を参照。主操作は明示Insertに確定。Phase 1では基盤を実装し、Phase 2/3の製品UI・挿入統合は別gateとする。

- 目標/ファイル: package、extension lifecycle、最小TreeView/dropProvider、unit runner、integration fixture、CI。
- テスト: type/lint/build、activation、通常/Shift drop、位置、空insertText+additionalEdit、Undo、cancel、別document、drop無効設定。
- 合格: 独自URIが届き1回だけ指定位置へ挿入。未選択/取消しでdocument不変。F5/CI手順を文書化。
- リスク: UI経路は型だけでは証明できない。不成立ならUI方針再レビュー。

### Phase 1 — metadata/storage/version/search

- 目標/ファイル: core metadata/assets/version/search、roots/discovery/safePaths、schema/examples。
- テスト: nested unknown/巨大number保持、known path編集、format各状態、version/range、hash/conflict、malformed隔離、両scope/multi-root、ranking/modifiers。
- 合格: 共通loaderで両scope、一部不正で全体を落とさない。future format read-only、同revision conflict、unknown保持。
- リスク: lossless write、content定義、大量asset性能。

### Phase 2 — UI/作成/Pack/copy

2026-10-09実装結果は[Phase 2結果](phase2-results.md)。利用者の追加指示でnative Snippets/Packs、単一中央detail panel、明示Insert adapterを採用。Pack内は一UUIDにつき一version、異なるPack/library全体には複数versionを許容する。保存はPack単位、外部変更は明示Reload、sourceは通常editor。Phase 3は別承認gate。

- 目標/ファイル: snippetTree/packTree/searchInput/detailsPanel/metadataForm、create/edit/packEditor/copy/delete、resolver、userState、transactions/watcher。
- テスト: Selection/File/new作成、create/edit同form、Default、recursive closure、delete制約、scope対称copy、multi-select、cancel、Reload/Later、自己write通知抑制。
- 合格: 保存→検索→詳細→source edit、detail panel1つ、copy原本維持、Pack自己完結、依存を壊す削除不可。
- リスク: source変更/version、外部編集/form競合。

### Phase 3 — insertion/dependencies/templates

2026-10-09、共通adapterへ唯一のpipelineを接続した。[Phase 3結果](phase3-results.md)を参照。generic structure-awareはplaintextの明示file targetのみ。separate-filesは新規folderのatomic publishで、editor Undo外。混在editor/file planは拒否する。D&Dはruntimeから除去し、Phase 0の実証testsのみ保持した。Phase 4は別承認gate。

- 目標/ファイル: insertion/template/dependency graph、genericProvider、commands/dropProvider。
- テスト: mode precedence、SCC/topology、diamond/backtracking、name warning、適合なし、全source input1回、required/cancel/literal replacement、stale/overlap、separate-files非上書き。
- 合格: 一覧button/右クリック/command/Pack詳細の明示Insertは同plan。補助dropを残す場合も同planへ接続する。通常は余分なpromptなし。不正planで部分code/file変更なし。D&Dなしで主要機能が成立する。
- リスク: async入力/document変更、既存依存識別、multi-file rollback。

### Phase 4 — ZIP/preview/conflict

2026-10-09、[Phase 4結果](phase4-results.md)のとおり実装。標準Diff、通常ZIP、明示whole-Pack Fork/compatible newer revision Replace、任意markerを追加した。同version content conflictの強制overwrite、mixed editor/file transaction、Clean Copyは実装していない。Phase 5は別承認gate。

- 目標/ファイル: archive、importExport、conflictPicker、security docs。
- テスト: ZIP roundtrip、preview分類、Zip Slip、case/Unicode/reserved/ADS、symlink、duplicate entry/UUID、bomb/size偽装、JSON/CRC、cancel/write/rename failure、残存journal回復。
- 合格: 普通のZIP toolで読める。確定前root不変、failureで原本保持。diff/new version/fork/明示replace導線。
- リスク: multi-Pack transaction、filesystem provider差。安全なwrite不可なら制限。

### Phase 5 — 基本Clean Copy

- 目標/ファイル: clean pipeline/presets、cleanCopyPanel。未対応言語は無変換copy。
- テスト: selection/file、clipboard/untitled/output、原本不変/alias拒否、notice dedup、unsupported transform/cancel。
- 合格: previewと出力一致、対応範囲明示、source非上書き。
- リスク: whitespace/commentを安全な文字列操作と誤認すること。

### Phase 6 — C# Roslyn/structure/Bundle

- 目標/ファイル: csharp helper/client/protocol、bundle、syntax clean。
- テスト: namespace/type/member/top-level、generic/partial/overload、using各形式、raw/interpolated string、preprocessor/parse error、collision/曖昧export、missing runtime/crash/cancel、参照→閉包。
- 合格: 合法targetへ配置、不明な構造へ黙って挿入しない。代表的Bundle fixtureをdotnet compileし結果確認、source不変、.NETなしで基本TCP起動。
- リスク: runtime/参照assembly、C# language version、binding変化。

### Phase 7 — polish/Git/release

- 目標/ファイル: integration/git、settings、accessibility/i18n、README/CHANGELOG、VSIX/CI、performance fixtures。
- テスト: 明示status/commit/pull/push、非repo/認証failure、restricted workspace、keyboard、large library、desktop OS/Remote、最低版/現行VS Code、VSIX install。
- 合格: 手順/既知制限明記、配布artifactの不要file除外、Git自動pull/pushなし。
- リスク: runtime容量、Marketplace publisher/ライセンス。公開配布前に別途製品判断。

## 12. テスト戦略・UX簡素化

core testsはVS Codeなしでversion/range、losslessness、conflicts、dependencies、templates、safePaths、searchの不変条件を検証。実Windows temp folderでcase/reserved/junction、敵対的archiveと途中failureをintegration検証。Extension Hostでactivation/commands/drop edit/Undo/panel再利用/watcher/clipboard。provider直接呼出しだけでは実dragを証明できないので手動再現手順も残す。

C# outputはsnapshotだけでなく代表fixtureのcompile/実行結果を検証する。製品にworkspace build機能を追加する意味ではない。GitHub CIはunit/build常設、host integrationはOS別。

通常UIにUUID/resolver graph/transactionを露出させない。行は名前/短い説明/language/version/scope、featuresは詳細。advanced formは折り畳み、依存自動追加はPack form/previewで示す。通常Insertは1操作、template/conflictのみ追加input。

watcherは初期500ms debounceで1通知。Later後はbadgeを残してeventごとに再通知しない。Reloadで新snapshotへ。自己writeはtransaction expected hash照合で抑制し、時間窓だけで同時外部編集を捨てない。stale時のmutation前に実file再確認。

## 13. 製品責任者に必要な判断（3点）

1. **一覧UX:** v1はnative TreeView + QuickInput検索 + Webview詳細でよいか。推奨はこの案。常設検索/自由なcardが必須ならD&D試作結果で再設計する。
2. **Pack依存:** 既存Pack内部で解決し、Workspace優先は候補選択/新Pack構築に適用してよいか。推奨はこの案。常時Workspace overrideならPackによる再現性を緩める必要がある。
3. **C# runtime:** 高度C#を任意.NET runtime依存の小さいhelperにしてよいか。推奨はこの案。インストール不要を優先するならOS/architecture別self-contained容量と配布作業を受け入れる。

canonical version、`-0`順、path/security等は工学的判断として上記案を推奨し、個別承認を増やさない。レビュー承認後Phase 0へ進む。Marketplace公開は含めない。Global Snippet Gitの自動pushを無効にする製品仕様と、この開発repoをcommit/pushする利用者依頼は別扱い。
