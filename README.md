# Turbo Code Palette

VS Codeで再利用可能なコードを探し、明示的なInsertで挿入するための拡張です。基本UXは「editorで位置を選ぶ → Snippetを検索/選択 → Insert」。SnippetをGlobal/Workspaceで管理し、自己完結したPackとして配布する構想です。

**現在はPhase 5までの実装です。** native一覧・共通Insertion pipeline・標準Diff・`.tcp-sp` Import/Exportに加え、安全性を限定したClean Copyを実装しています。安全に判断できないケースは停止します。

- [v1仕様書](docs/product-spec.md)
- [設計・API・セキュリティ監査と段階的な実装計画](docs/architecture-review.md)
- [Phase 0の結果・検証範囲・未解決事項](docs/phase0-results.md)
- [Phase 1の結果・検証範囲・未解決事項](docs/phase1-results.md)
- [Phase 2の結果・検証範囲・未解決事項](docs/phase2-results.md)
- [Phase 3の結果・Insert範囲・Undo/制限](docs/phase3-results.md)
- [Phase 4の結果・ZIP security・Conflict/Diff・marker](docs/phase4-results.md)
- [Phase 5の結果・Clean Copy保証範囲・Bundle review](docs/phase5-results.md)
- [確定した明示Insert方針](docs/insertion-ux-policy.md)
- [追加D&D UX調査・候補比較・Research PoC](docs/dnd-ux-investigation.md)
- [公開repositoryのチェック手順](docs/public-repository-security.md)
- [GitHubリポジトリ](https://github.com/oz-coden/turbo-code-palette)

`formatVersion`はmetadata schema、`version`はasset revisionとして独立します。意味不変migrationはformatVersionだけ更新でき、asset version増加を要求しません。Phase 5完了後、Phase 6には自動で進みません。

## Libraryの操作

Activity BarのTurbo Code Paletteを開き、Snippets/Packs一覧から詳細を選びます。toolbarの検索やCommand Paletteの`Search Snippets` / `Search Packs`で絞り込めます。Workspaceは各folderの`.snippets`、Globalはextension storageの`snippets`（またはmachine設定`turboCodePalette.globalRoot`）です。読み込みだけではfolder/Default Packを作りません。

`Create Snippet from Selection` / `Create Snippet from Current File` / `New Snippet`で作成します。metadataをformに入力してSaveすると検索・詳細へ反映されます。sourceはOpen sourceで通常editorに開きます。sourceを保存したら`Reload Library`で確認し、metadata formで新しいSnippet versionを保存してください。Packのcreate/editも同じformで、Snippet検索・追加、依存closureのpreviewを使えます。

右クリックのCopy to Workspace/Globalで、SnippetはDefault/new Packへ依存を含めてcopyし、Packは全体をcopyします。原本は維持します。**同一Pack内では同じSnippet UUIDを一つのversionだけ保持します。異なるPackやlibrary全体では複数versionを共存できます。** identicalなscope間copyは一行にまとめ、version違いは別行、同revisionの内容違いはconflictにします。

外部変更はReload / Laterで通知し、自動Reloadしません。Later後はbadgeを残します。Globalには`Open Global Library Folder` / `Reveal Global Library` / `Configure Global Root`からアクセスできます。未完了保存が通知された場合は`Review Interrupted Save`で確認します。原子性・provider制限はPhase 2結果文書を参照してください。

検索例: `Minimum lang:"C#" tag:"small helper" version:">=v1.0.0 <v2.0.0"`。未知modifierや不正versionは結果を広げずerrorにします。future metadataはread-only、同UUID/versionで異なる内容はconflictです。[schemas](schemas)はunknown fieldsを許容します。

## Insert

editorで位置/selectionを選び、一覧Insert、右クリックInsert、Command Paletteの`Insert Snippet`、Pack詳細memberのInsertを実行します。`Insert Snippet with Mode…`で利用可能なmodeを選べます。templateがあれば入力し、warning/optional preview後にtarget/assetsを再検証してapplyします。single-document挿入は一回のUndoで戻せます。

separate-filesはnative workspace内の新規folderへ出力し、既存fileを上書きしません。**file作成はeditor Undoの対象外**で、editor/fileの混在planは拒否します。structure-awareはplaintextの明示file targetのみ。C#等で未対応なら代替modeを明示選択します。generic collision/既存実装検証の限界はPhase 3結果を参照してください。`previewBeforeInsert`は既定falseです。

previewを有効にすると、任意のCompareからVS Code標準Diffでcurrent/planned contentを比較できます。ConflictではInsert/copyを停止してCompareを案内します。同UUIDのrevision/locationは一覧の右クリック、詳細、Command Paletteの`Compare Asset Revisions / Locations`から比較できます。Diffは読み取り専用の一時snapshotで、比較だけでは挿入・置換・usage更新を行いません。

`sourceMarkers`は既定falseです。ONにすると、対応言語の安全な行境界/contextに限りUUID/version/hashのcommentを付けます。文字列/comment等の可能性を保守的に除外できない場合や未対応言語ではmarkerを省略します。markerだけで既存実装の互換性を断定しません。Clean Copyで安全な独立comment lineと確認できるBEGIN/ENDだけを除去できます。

## Clean Copy

TCP sidebarの**Clean Copy** section、またはCommand Paletteの`Clean Copy`からSelection / Current File / Dependency Bundleを選びます。Readable / Competitive / Customを選び、Clipboard / Preview・Untitled / Save Asへ出力します。原本は変更しません。Previewと出力は同じ固定final planを使います。

helperなしのReadableとCompetitiveは同じ安全なtransformだけです。対応providerで確認できるTCP marker commentの内容だけを除去し、改行・通常comment・whitespaceを残します。C# Roslyn providerではCompetitiveに、単体semantic解析で証明できるunused using除去と安全なwhitespace normalizationを追加します。Customは利用可能なtransformだけを選択でき、C#ではsyntax-awareな通常comment/XML doc除去も選べます。unsafeなrename、minify等へのfallbackはありません。

`licenseNotices[].text`はexact textでdeduplicateし、全Presetで保持します。対応providerの安全なcomment headerで再付与できなければ出力を停止します。未対応言語へ別言語のcommentを強制しません。TCPはnoticeを法的に除去できるか判断しません。

**generic Dependency Bundleはreview用JSONです。** known exportのtext hitは自動採用せずSnippetを明示選択します。C# helper有効時はsemantic single-file Bundleも選択できます。実symbol referencesをreview済みexportsへ対応付け、同じmetadata resolverでclosureを取得し、構文nodeから構築して単体compilation/Emitを検証します。未解決参照、複数revision、異なるusing scopes、directive等は停止します。元workspace/projectをbuildする機能はありません。

Save Asはnative filesystemの新規filenameだけです。source URI、projected Untitled source、library内、既存file、case/Unicode alias、symlink/junction親を拒否します。exclusive publishにはhardlink対応filesystemが必要です。preview中の編集・Reload・root/provider変更・asset変更時は出力を止めます。Clean Copyはusage/recent等を更新しません。

## Optional C# / AtCoder Policy

TCP本体は.NET非依存です。Roslyn helperを使う場合だけ.NET 10 SDKで`npm run build:csharp`し、VS Code Settingsの`csharpHelperPath`へ信頼するDLLのローカル絶対pathを設定してReload Windowします。設定はmachine専用でrepositoryへcommitしません。`C# Provider Status`で利用不能理由を確認でき、`Cancel Current C# Operation`で中止できます。helper未設定なら従来のgeneric機能を使えます。helperのsource・protocol・制限は[csharp/README.md](csharp/README.md)を参照。

Snippet作成/metadata編集formのAdvancedからC# exports候補を検出し、確認・編集して保存できます。source code自体は通常editorで編集します。structure-aware Insertは明示insert.targetsとRoslynのsyntax/semantic検証を使用し、不明な場所へfallbackしません。project評価は行わず、明示language version/definesがなければC# 14単体解析の限界をdiagnosticで知らせます。

[AtCoder公式20261014変更](https://github.com/atcoder/rules/commit/61500f0afb842798a5ab626725350059540bec04)に対応する共通基盤として、Presetと独立した`compliancePolicy: atcoder-20261014`をSettingsで選べます。既定はnone。参照URLは既存`source[].url`、AI由来の申告は`provenance.aiUsage`、公開申告は`source[].publication/publishedAt`をraw metadataで扱います。repository[]はrepository所在地のままです。AI/unknown由来には、URLと明示contest開始以前のpublic公開申告が必要です。

Insert/Clean Copy/Bundleでは出典URLとlicense noticeを収集・保持します。Source URL commentはoptional TCP BEGIN/END markerとは別で、marker OFFでも付加します。AtCoder Policyでは将来の未知transformを拒否し、未分類licenseを失わないよう全non-marker commentを保持します。出典/noticeを保持できない出力は停止します。**Webでの事前公開、申告の真偽、licenseの完全性、提出資格は検証・保証せず、準拠済みとは表示しません。** 専用Policy formと公開日時の証跡検証は後続候補です。

対応範囲、測定値、テスト、残る制限は[Phase 6結果](docs/phase6-results.md)を参照してください。

## Pack Import / Export

Packs toolbarまたはCommand Paletteの`Import Pack (.tcp-sp)`で通常ZIPを選び、Workspace/Globalを選択します。library外のprivate stagingで完全検証してから、additions / identical / different-version / conflictsを表示します。確定前のキャンセルではlibraryを変更しません。全scopeの同UUID/version content conflictがある場合、通常Importを拒否します。

Compare後に明示的な`Fork whole Pack`を選べます。Packと全SnippetのUUID、既知の内部dependency UUIDを新規生成します。source bytes、version、unknown metadataは保持するため、unknown field内の独自UUID参照はユーザーが確認してください。different versionsは別Packとして共存可能です。`Replace older Pack`は内容変更したSnippetも新しいversionである場合だけ表示し、明示確認後に一Packの既存transaction/journalで保存します。同versionの異なる内容を直接overwriteする操作はありません。新しいrevisionは既存metadata formで明示的に作成します。

Pack右クリック、詳細または`Export Pack (.tcp-sp)`でlibrary外の新規filenameへExportします。root `pack.json`、全file、empty directories、unknown metadataを保持し、原本を変更しません。既存archiveはoverwriteせず、新しいfilenameを要求します。v1 Import/Exportはnative local filesystemのみ。Exportのexclusive publishにはhardlinkを作成できるfilesystemが必要で、未対応の場合は停止します。

## 合成Insert demo / D&D履歴

editorで挿入位置を選び、demo行のInsert button、右クリックInsert、またはCommand Paletteの`Insert Demo Snippet`を実行します。行の選択/previewだけでは挿入しません。

Phase 3で補助D&Dを製品runtimeから外しました。drag controller/drop providerの登録・設定はありません。Phase 0のAPI実証code/testsは履歴として残し、製品Insertから分離しています。demo viewは既定非表示です。Webview/raw fallbackによる通常dropは提供しません。

```sh
npm run dev:host
```

隔離されたExtension Development Hostで、command paletteから`Turbo Code Palette: Open Phase 0 Drop Target`を実行します。2つのdemoを挿入し、Ctrl+Zで戻せます。このdemoは個人のGlobal/Workspace Snippet dataを作りません。

## 開発

Node.js/npmを使います。現在のVS Code engineは`^1.134.0`です。

```sh
npm ci
npm run compile
npm run test:unit
```

`compile`は型チェック、lint、esbuildを実行します。VS Codeでこのfolderを開いてF5を押すとExtension Development Hostを起動できます。

```sh
npm test
npm run test:host
npm run package
npm run check-public -- --history
```

`test:unit`はVS Codeなしのcore/service/security tests、`test`は最低対応版1.134.0のGUI Hostです。`test:host`はインストール済みWindows VS Codeを使い個人profileを共有しません。別環境ではTCP_VSCODE_EXECUTABLEを指定できます。任意の.NET testsは`npm run test:csharp`、計測/生成Bundle compile検証は`npm run measure:csharp`です。helper/テストpeerをbuild済みの場合だけNode/Hostの.NETケースも実行し、CIではbuildして省略せず検証します。テスト/downloadにはネットワーク・GUI実行が必要です。GUI Hostはversionごとに単独起動してください。

Research UX Labは除去しました。比較結果と当時のcommitはD&D UX調査文書に残っています。

`package`は配布用JavaScript bundleのビルドで、VSIX生成やMarketplace公開は行いません。commit/push前にはpublic scanに加えstatus・tracked files・diffを確認してください。

## 実装予定

1. 開発・テスト基盤とnative sidebarからeditorへのD&D検証
2. open metadata、storage、identity/version、検索
3. Snippet/Packの一覧・詳細・作成・編集・コピー
4. 依存解決、template variables、挿入
5. 安全な`.tcp-sp` ZIP import/exportとconflict処理
6. 基本Clean Copy、C# providerとDependency Bundle
7. Git convenience、操作性、配布検証

詳細なacceptance criteriaと延期機能は設計レビューを参照してください。製品としてGitの自動pull/pushや挿入後コードの同期は行わない方針です。
