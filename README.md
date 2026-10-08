# Turbo Code Palette

VS Codeで再利用可能なコードを探し、ドラッグまたはInsertで挿入するための拡張です。SnippetをGlobal/Workspaceで管理し、自己完結したPackとして配布する構想です。

**現在は実装前レビュー段階です。** 実行可能なコードはVS Code生成ひな形のHello Worldのみで、Snippet管理等の製品機能はまだ実装されていません。

- [v1仕様書](docs/product-spec.md)
- [設計・API・セキュリティ監査と段階的な実装計画](docs/architecture-review.md)
- [GitHubリポジトリ](https://github.com/oz-coden/turbo-code-palette)

仕様書は最初に監査を行い、レビュー承認後に段階的な実装へ進むよう指定しています。監査の判定は **GO WITH NOTES** です。D&Dの最小試作、Pack依存の適用範囲、C# providerのruntimeを確認してから実装します。

## 開発

Node.js/npmを使います。現在のVS Code engineは`^1.134.0`です。

```sh
npm ci
npm run compile
npm run compile-tests
```

`compile`は型チェック、lint、esbuildを実行します。VS Codeでこのfolderを開いてF5を押すとExtension Development Hostを起動できます。

```sh
npm test
npm run package
```

`test`はVS Codeのテスト用runtimeを取得し、GUIのExtension Hostを起動する場合があります。現在のテストは生成ひな形のサンプルのみです。`package`は配布用JavaScript bundleのビルドで、VSIX生成やMarketplace公開は行いません。

## 実装予定

1. 開発・テスト基盤とnative sidebarからeditorへのD&D検証
2. open metadata、storage、identity/version、検索
3. Snippet/Packの一覧・詳細・作成・編集・コピー
4. 依存解決、template variables、挿入
5. 安全な`.tcp-sp` ZIP import/exportとconflict処理
6. 基本Clean Copy、C# providerとDependency Bundle
7. Git convenience、操作性、配布検証

詳細なacceptance criteriaと延期機能は設計レビューを参照してください。製品としてGitの自動pull/pushや挿入後コードの同期は行わない方針です。
