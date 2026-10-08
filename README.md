# Turbo Code Palette

VS Codeで再利用可能なコードを探し、明示的なInsertで挿入するための拡張です。基本UXは「editorで位置を選ぶ → Snippetを検索/選択 → Insert」。SnippetをGlobal/Workspaceで管理し、自己完結したPackとして配布する構想です。

**現在はPhase 1の基盤実装です。** 共通loader、lossless metadata、独自version/range、hash/conflict、検索を実装しました。既存libraryの読み込み・検索はinspection commandで確認できます。製品の一覧/編集/Pack UIと高度な挿入処理は後続Phaseです。sidebarのInsertはまだ合成demo専用です。

- [v1仕様書](docs/product-spec.md)
- [設計・API・セキュリティ監査と段階的な実装計画](docs/architecture-review.md)
- [Phase 0の結果・検証範囲・未解決事項](docs/phase0-results.md)
- [Phase 1の結果・検証範囲・未解決事項](docs/phase1-results.md)
- [確定した明示Insert方針](docs/insertion-ux-policy.md)
- [追加D&D UX調査・候補比較・Research PoC](docs/dnd-ux-investigation.md)
- [公開repositoryのチェック手順](docs/public-repository-security.md)
- [GitHubリポジトリ](https://github.com/oz-coden/turbo-code-palette)

`formatVersion`はmetadata schema、`version`はasset revisionとして独立します。意味不変migrationはformatVersionだけ更新でき、asset version増加を要求しません。Phase 1完了後、Phase 2には自動で進みません。

## 基盤の確認

command paletteから`Turbo Code Palette: Reload Phase 1 Catalog`、`Turbo Code Palette: Search Phase 1 Catalog (Read Only)`を実行できます。Workspaceは各folderの`.snippets`、Globalはextension storageの`snippets`（またはmachine設定`turboCodePalette.globalRoot`）です。読み込みだけではfolder/Default Packを作りません。[合成fixture](src/test/fixtures/library)をGlobal rootとして指定するとデータ形式を試せます。

検索例: `Minimum lang:"C#" tag:"small helper" version:">=v1.0.0 <v2.0.0"`。未知modifierや不正versionは結果を広げずerrorにします。future metadataはread-only、同UUID/versionで異なる内容はconflictです。[schemas](schemas)はunknown fieldsを許容します。

## 合成Insert demo / 補助D&D

editorで挿入位置を選び、demo行のInsert button、右クリックInsert、またはCommand Paletteの`Insert Demo Snippet`を実行します。行の選択/previewだけでは挿入しません。

D&Dは補助機能として既定offです。`turboCodePalette.enableAuxiliaryDragAndDrop`を有効にしてwindowをreloadするとdemoで使えます。操作は**Snippetを掴む → editorへ移動 → ドロップ直前にShiftを押す → マウスを離す**。Shift+click/右クリックではありません。将来改修が必要なら廃止を検討し、未知の競合操作やVS Code干渉が生じたら積極的に廃止する方針です。Webview/raw fallbackによる通常dropの実験は終了しました。

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

`test:unit`はVS Codeなしのcore/security tests、`test`は固定した最低対応版1.134.0のGUI Hostでintegration testsを実行します。`test:host`はインストール済みWindows VS Codeを使い、個人profileを共有しません。別環境ではTCP_VSCODE_EXECUTABLEを指定できます。件数/実行結果はPhase 1結果文書を参照。テスト/downloadにはネットワーク・GUI実行が必要です。

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
