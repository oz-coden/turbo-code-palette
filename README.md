# Turbo Code Palette

VS Codeで再利用可能なコードを探し、明示的なInsertで挿入するための拡張です。基本UXは「editorで位置を選ぶ → Snippetを検索/選択 → Insert」。SnippetをGlobal/Workspaceで管理し、自己完結したPackとして配布する構想です。

**現在はPhase 3までの実装です。** native一覧・単一詳細panel・作成/Pack/copyに加え、全Insert入口から共通pipelineを使って依存、template、mode、conflict/stale検証、preview、一括適用を行います。安全に判断できないケースは停止します。

- [v1仕様書](docs/product-spec.md)
- [設計・API・セキュリティ監査と段階的な実装計画](docs/architecture-review.md)
- [Phase 0の結果・検証範囲・未解決事項](docs/phase0-results.md)
- [Phase 1の結果・検証範囲・未解決事項](docs/phase1-results.md)
- [Phase 2の結果・検証範囲・未解決事項](docs/phase2-results.md)
- [Phase 3の結果・Insert範囲・Undo/制限](docs/phase3-results.md)
- [確定した明示Insert方針](docs/insertion-ux-policy.md)
- [追加D&D UX調査・候補比較・Research PoC](docs/dnd-ux-investigation.md)
- [公開repositoryのチェック手順](docs/public-repository-security.md)
- [GitHubリポジトリ](https://github.com/oz-coden/turbo-code-palette)

`formatVersion`はmetadata schema、`version`はasset revisionとして独立します。意味不変migrationはformatVersionだけ更新でき、asset version増加を要求しません。Phase 3完了後、Phase 4には自動で進みません。

## Libraryの操作

Activity BarのTurbo Code Paletteを開き、Snippets/Packs一覧から詳細を選びます。toolbarの検索やCommand Paletteの`Search Snippets` / `Search Packs`で絞り込めます。Workspaceは各folderの`.snippets`、Globalはextension storageの`snippets`（またはmachine設定`turboCodePalette.globalRoot`）です。読み込みだけではfolder/Default Packを作りません。

`Create Snippet from Selection` / `Create Snippet from Current File` / `New Snippet`で作成します。metadataをformに入力してSaveすると検索・詳細へ反映されます。sourceはOpen sourceで通常editorに開きます。sourceを保存したら`Reload Library`で確認し、metadata formで新しいSnippet versionを保存してください。Packのcreate/editも同じformで、Snippet検索・追加、依存closureのpreviewを使えます。

右クリックのCopy to Workspace/Globalで、SnippetはDefault/new Packへ依存を含めてcopyし、Packは全体をcopyします。原本は維持します。**同一Pack内では同じSnippet UUIDを一つのversionだけ保持します。異なるPackやlibrary全体では複数versionを共存できます。** identicalなscope間copyは一行にまとめ、version違いは別行、同revisionの内容違いはconflictにします。

外部変更はReload / Laterで通知し、自動Reloadしません。Later後はbadgeを残します。Globalには`Open Global Library Folder` / `Reveal Global Library` / `Configure Global Root`からアクセスできます。未完了保存が通知された場合は`Review Interrupted Save`で確認します。原子性・provider制限はPhase 2結果文書を参照してください。

検索例: `Minimum lang:"C#" tag:"small helper" version:">=v1.0.0 <v2.0.0"`。未知modifierや不正versionは結果を広げずerrorにします。future metadataはread-only、同UUID/versionで異なる内容はconflictです。[schemas](schemas)はunknown fieldsを許容します。

## Insert

editorで位置/selectionを選び、一覧Insert、右クリックInsert、Command Paletteの`Insert Snippet`、Pack詳細memberのInsertを実行します。`Insert Snippet with Mode…`で利用可能なmodeを選べます。templateがあれば入力し、warning/optional preview後にtarget/assetsを再検証してapplyします。single-document挿入は一回のUndoで戻せます。

separate-filesはnative workspace内の新規folderへ出力し、既存fileを上書きしません。**file作成はeditor Undoの対象外**で、editor/fileの混在planは拒否します。structure-awareはplaintextの明示file targetのみ。C#等で未対応なら代替modeを明示選択します。generic collision/既存実装検証の限界はPhase 3結果を参照してください。`previewBeforeInsert`は既定falseです。

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

`test:unit`はVS Codeなしのcore/service/security tests、`test`は固定した最低対応版1.134.0のGUI Hostでintegration testsを実行します。`test:host`はインストール済みWindows VS Codeを使い、個人profileを共有しません。別環境ではTCP_VSCODE_EXECUTABLEを指定できます。件数/実行結果はPhase 3結果文書を参照。テスト/downloadにはネットワーク・GUI実行が必要です。

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
