# Phase 1 結果

実施日: 2026-10-09（日本時間）。architecture reviewのmetadata/storage/version/search基盤を実装・検証した。Phase 1 acceptanceを満たし、ここで停止する。Phase 2へ自動では進まない。

主操作は[明示Insert方針](insertion-ux-policy.md)。D&Dは補助として既定off。今後の改修時は廃止を検討し、未知の競合やVS Code干渉が生じた場合は積極的に廃止する。研究用Webview/custom/raw D&Dのruntime・source・commandは除去した。過去の実証はGit履歴と[D&D調査](dnd-ux-investigation.md)に保存する。

## 実装とacceptance

| 合格条件 | 実装 / 確認 |
| --- | --- |
| 共通loaderで両scope | 同じ`loadCatalog`をGlobalと全Workspace folderの`.snippets`へ適用。合成fixtureの両scope copyを読んで同じlogical groupへ集約。読み込みだけではfolder/Default Packを作らない |
| 不正assetの個別隔離 | malformed JSON/必須field不正/missing source/unsafe reference/link/collisionを除外し、同じPackの正常Snippetや別Packは読み続ける。壊れたmemberを持つPack全体は操作対象にしない |
| future format read-only | known fieldと安全なsource情報は読む。structured edit/migration/Insertを止め、semantic hashは未確定。current copyとの意味的同一性を推測しない |
| 同revision conflict | UUID/versionが同じでsemantic hashが違えばconflict。source byte・README等の差も含む。等しい内容は全locationを集約。Pack内のduplicate Snippet UUIDは操作停止 |
| unknown metadata保持 | strict JSONのAST/tokenとoffset editを使用。未知のnested object/array、巨大number、fraction/exponent、escaped string、`__proto__`をdataとして保持。既知の子fieldだけ編集し、未知subtreeを含むcontainer全置換を拒否 |
| format/asset version独立 | missing/0→1の明示migrationで未知tokenとasset versionを保持。意味が変わるmetadata編集は新しいasset revisionが必要。future/invalidの変更は拒否 |
| version/range/search | BigIntによる4component比較、missing patch < `-0`、32桁component上限。AND比較だけを受理し空/不正rangeで広げない。quoted modifierとmetadata由来の補完、名前→tag/category→feature→説明のrank、scope/version/UUIDによるtie-break |

metadataは[Microsoft jsonc-parser](https://github.com/microsoft/node-jsonc-parser)の公開AST/offset edit APIを使うが、保存形式はstrict JSON。comment、trailing comma、duplicate key、1 MiB超metadata、64超nestingを拒否する。`formatVersion`は非負整数の数値として判定し、`1.0`/`10e-1`も1として扱う。巨大値をJS numberへ丸めて書き戻さない。

semantic fingerprintはformatVersionを除き、既知UUIDのcaseを正規化する。object順/空白を無視、array順・文字列値・unknown numeric tokenを保持。integrity fingerprintと保存直前のbyte hashは別の用途。unknownの`1`と`1.0`は同一と推測しない。

`writeMetadata`は明示的なmetadata-only操作の基盤。temp siblingをexclusiveに作り、sync後に原文byte hashを再確認してrenameする。stale/validation errorなら原本を書き換えず、自分のtemporary fileだけを除去する。format upgradeは自動実行しない。source/Pack member変更を伴うtransaction、Pack versionの連動更新、fork/replace UIはPhase 2以降の責務。

## 動作確認

| 検証 | 結果 |
| --- | --- |
| `npm run test:unit` | 36件pass、0 fail/skip。Phase 1追加23件、既存insertion/security 13件 |
| `npm test` | Windows / VS Code 1.134.0、実Extension Hostで15件pass |
| `npm run test:host` | Windows / VS Code 1.140.0、実Extension Hostで15件pass |
| type / lint / development bundle | pass。Hostが実際にbundleをactivate |
| production bundle | `npm run package`後にそのbundleを実Hostで起動し15件pass。Marketplace公開/VSIX配布は未実施 |
| dependency audit | `npm audit`で0 vulnerabilities。開発用brace-expansion/js-yaml/shell-quoteを互換範囲内の修正版へ更新 |

unit testsは実temporary treeでjunction/hardlink拒否、Unicode衝突の双方隔離、source/README hash差、保存前の別writerの変更保持・temporary cleanupも検証する。fixtureと実行時生成dataを分離し、生成dataは`.vscode-test`内のみ。

Hostの追加4件はconfigured Globalの読み込み/search command、drop無効時の明示Insertと一回Undo、public URI filesystem adapter、Research command除去とD&D既定offを検証する。既存11件はcancel/stale/opaque URI/preview/EOF等。native mouse dragを再検証したという意味ではない。今turnでComputer Useを再接続せず、自動Host testsで検証した。

## 確認用commandとデータ

`Turbo Code Palette: Reload Phase 1 Catalog`は読み込み件数/diagnostic codeを返す。`Turbo Code Palette: Search Phase 1 Catalog (Read Only)`はinspection用検索。Commandの戻り値はRPCに渡せる単純dataで、循環ASTやBigInt、絶対storage pathを渡さない。Outputにも件数/scope/codeだけを出す。

`schemas/*.schema.json`はunknown fieldを許容する。`src/test/fixtures/library`は公開用の合成Pack/Snippet例。個人Global/Workspace dataではない。Global設定はmachine scopeの`turboCodePalette.globalRoot`。rootを明示する場合はhost上の絶対directoryを使い、その値をrepositoryの設定へ保存しない。

検索例: `Minimum lang:"C#" tag:"small helper" scope:global version:">=v1.0.0 <v2.0.0"`。`lang/tag/category/pack/scope/version/author/feature`を受理する。bare `version:v1.0.0-0`はexact指定の略記。誤ったmodifierやversion指定はerrorとして扱う。

## 制約と後続事項

- 実Snippet一覧/form/Pack詳細/copy/delete/watcherはPhase 2。現在のsidebarは合成Insert demo専用で、catalogのsearch結果を実Snippet挿入へは接続していない。
- 全入口の共通Insertion pipeline、template/dependency/conflict/preview/mode/stale targetの完成はPhase 3。現在のdemo Insert button/右クリック/commandは同じcommand/plannerへ接続し、D&D無効でも機能する。Pack詳細の入口はそのUIを作るPhase 2で設ける。
- native readerはancestor link/junction/hardlink/nonregular entryを拒否し、read前後に再確認する。hostileな別processによる全raceを完全防御する保証ではない。metadata writeはfilesystem renameが失敗すれば中止し、multi-file rollbackはまだ実装していない。
- 実Hostの`globalStorageUri`がfile以外のURIとして渡されたケースを確認した。その場合は[公開workspace.fs API](https://code.visualstudio.com/api/references/vscode-api#FileSystem)で同じloaderへ接続する。`FileStat`にはhardlink countがなく、streaming readもないため、このadapterのlocationはinspection-only (`usable=false`)。physical pathへの内部mappingは推測しない。URI storageへの安全なwrite/Insert許可は後続Phaseで判断する。
- native Workspace/configured Globalはhost-local filesystem対象。non-file workspace、Web/Remote/他OSの製品対応は未検証。大規模libraryのbenchmark/caching、dependency closure、format変換に伴うsource/依存変更、archive import/exportはこのPhaseに含めない。

公開前にstatus・tracked files・diff・public scan/historyを確認する。秘密情報、machine-specific path/config、node_modules、build/coverage/log/test/generated snippet dataを公開対象に含めない。既存ignoreで十分なため、source/lockfile/schema/fixtureを新たにignoreしない。history rewrite/force pushは行わない。
