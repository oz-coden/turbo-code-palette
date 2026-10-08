# Turbo Code Palette

VS Codeで再利用可能なコードを探し、ドラッグまたはInsertで挿入するための拡張です。SnippetをGlobal/Workspaceで管理し、自己完結したPackとして配布する構想です。

**現在はPhase 0のD&D実証版です。** native Snippet TreeViewから合成demoをeditorへ挿入できます。実Snippet/Pack管理等の製品機能はまだ実装していません。

- [v1仕様書](docs/product-spec.md)
- [設計・API・セキュリティ監査と段階的な実装計画](docs/architecture-review.md)
- [Phase 0の結果・検証範囲・未解決事項](docs/phase0-results.md)
- [追加D&D UX調査・候補比較・Research PoC](docs/dnd-ux-investigation.md)
- [公開repositoryのチェック手順](docs/public-repository-security.md)
- [GitHubリポジトリ](https://github.com/oz-coden/turbo-code-palette)

設計レビューを承認後、Phase 0を実装・検証しました。cursor/EOFのnative D&Dと一回のUndoを確認しています。formatVersionとasset versionは独立させ、意味不変migrationではasset version増加を要求しない方針です。

## D&Dの操作

**Snippetを掴む → editorへ移動 → ドロップ直前にShiftを押す → マウスを離す**の順です。Shiftを最初から押して行をクリックする操作やShift+右クリックではありません。明示Insertも使えます。

このShift-required操作を製品の唯一の主操作として確定してはいません。追加調査ではnative payloadの変更やWebview cardによる安定した通常dropは実証できず、明示Insertを主操作、D&Dを補助操作とする案を推奨しています。詳細は追加D&D UX調査を参照してください。

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

`test:unit`はVS Codeなしの13件のテスト、`test`は固定した最低対応版1.134.0のGUI Hostで17件のintegrationテストを実行します。`test:host`はインストール済みWindows VS Codeを使い、個人profileを共有しません。別環境ではTCP_VSCODE_EXECUTABLEを指定できます。テスト/downloadにはネットワーク・GUI実行が必要です。

`npm run dev:ux`または`npm run dev:ux:min`で隔離Research Hostを開き、`Turbo Code Palette: Open D&D UX Lab (Research)`を実行するとnative payload / Webview cardの比較PoCを表示します。通常dropの成功を保証する機能ではありません。

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
