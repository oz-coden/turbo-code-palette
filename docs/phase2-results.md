# Phase 2 — UI / 作成 / Pack / copy

2026-10-09。Phase 1承認後の指示に従って実装。Phase 3には進んでいない。実SnippetのInsert入口はadapterとして用意したが、挿入処理は実装していない。

## 実装・UX

| 操作 | 結果 |
| --- | --- |
| Snippets / Packs | native sidebarの二つのview。名前、短いdescription、language、version、scope/Packを表示。featuresは詳細へ。長い表示を制限するがmetadata自体は変更しない |
| 検索 | toolbar / Command PaletteのQuickPick。Phase 1のmodifier、version/range、候補補完を再利用。All / Favorites / Recentで絞り込み |
| 詳細 | 中央Editor領域の一つのWebviewPanelを再利用。Snippetのfeatures、原文metadata、versions/locations、sources/preview、Packのdescription/metadata/member一覧 |
| Metadata Editor | 作成・編集で同じform。name/version/description、languages、sources、tags/features/authors/category/status/notes、dependency検索・constraint編集。advanced/optionalは折り畳み |
| Unknown fields | 完全な原文JSONを詳細/form内で表示。offset editで未知field・未知child・巨大数値のtokenを保持。author objectの未知child、dependency objectの未知childも保持 |
| source編集 | Open sourceで通常のVS Code editorを開く。formにcode editorを埋め込まない。未保存source/metadataが対象Packにあればmutationを拒否 |
| Snippet作成 | Selection / Current File / New。editorの現在のtext、EOL、languageをcapture。保存先はGlobal/WorkspaceとDefault/new Pack。Newは空sourceを作り通常editorへ開く |
| Pack作成・編集 | 同じformでSnippet検索・追加。closure previewに自動追加の名前/version/scopeを表示。保存時に再解決。依存を壊す削除は拒否 |
| Snippet copy | Copy to Workspace / Global。Default/new Packを選択し、transitive dependenciesを含めてcopy。コピー元を変更しない |
| Pack copy | member、metadata、README等の付随file、空directoryを含むPack全体をcopy。UUID/version/file bytesを維持。future Packはopaqueなbyte copyのみ |
| Multi-select | Snippetの集合copy、同一Pack内の集合delete、Packの集合copy。依存を削除するには残存するdependentも集合に含める |
| User state | favorites/recent/usageはMementoへ。UUID/version単位。閲覧だけではusageを増やさず、成功Insert後の加算はPhase 3の責務 |
| 外部変更 | 500ms debounceのwatcher。Reload / Later、pending badge。Later後にeventごとに再通知しない。root設定の変更も明示Reloadを要求 |
| Globalへのアクセス | Open Global Library Folder、Reveal Global Library、Configure Global Root。source/raw metadataも通常editorで開ける。空libraryは最初の保存まで生成しない（Open/Revealは明示的にfolderを作る） |

同じUUID/version/contentのWorkspace/Globalのコピーはlogical itemにまとめる。同じUUIDで異なるversionは別行に出し、そのまま操作できる。identical itemの詳細/Insertは代表locationを選び、詳細に全locationを示す。編集・削除・copy等で複数locationがある場合は対象を選択する。同じUUID/versionでもcontentが異なる場合はconflictとして区別し、locationを黙って選ばない。

**一つのPack内には同じSnippet UUIDを一つのversionだけ保持する。異なるPackやlibrary全体では同じUUIDの異なるversionを共存できる。** コピー先Packに別version/implementationがあれば拒否し、新規Packを選ぶよう案内する。

structured formで対象fieldを変更しない限り、unknown subtreeは原文のまま保存する。dependency/author entryを利用者が明示的に削除した場合はそのentry全体の削除になる。未認識author entryの一括置換は拒否する。insert/template/export/reference/license等のその他の複雑なmetadataは原文を保持し、Open raw metadataで明示的に編集できる。専用入力の拡充は対応する後続機能に合わせる。

## 保存・version・外部変更

mutationは共通`Library` serviceを通す。metadataのlossless document、version/range、共通loader、fingerprint、search/groupingはPhase 1のものを再利用する。Pack構成にはversion constraintの交差、diamond、cycle、backtracking、name mismatch warning、conflicting candidateの拒否と探索上限を持つresolverを追加した。

Packごとにprivate stagingを作り、path/file/byte制限、metadata/source/reference、重複UUID、dependency closureを検証する。元fileとコピー先を再hashし、dirty editor/root変更を再確認してから、relative-path journalを保存し、既存Packをbackupへ、新しいPackを本来の位置へrenameする。write/rename失敗時は元Packへ戻す。backupやtargetに予期しない外部変更があれば、それを上書き・削除せずrecovery dataを残す。

Defaultへの追加/削除、Snippet metadata変更は親Packのpatch revisionを進める。Pack formは新しいrevisionを初期値として提示する。Snippetの意味変更には新しいSnippet versionも必要。コピーしたSnippet/Pack自体のUUID/versionは変更しない。

`formatVersion`はschema、`version`はasset revision。明示Upgradeによる意味不変migrationではformatVersionだけを更新し、Snippet/親Packのversionを増やさない。

watcherはdiskを比較するだけでindexへadoptしない。自分の保存後は**変更したPackだけ**を更新する。他のPackの外部変更は残し、hash照合で通知する。時間窓だけで自己writeと判定しない。通知への回答待ちも次の検出を止めない。Reloadは保存中には実行させない。

通常editorでsourceを保存したら、Reloadして内容を確認し、metadata formでSnippet versionを更新する。TCPは通常editorのSaveを横取りしたり、外部保存でrevisionを自動変更したりしない。同revisionの別copyと内容が異なればconflictとして検出する。staleなformは保存前のfile再確認で拒否する。

未完了journalは起動/Reload時に通知する。Review Interrupted SaveでRestore / Keep new content / Laterを選ぶ。Restoreは未知の既存targetを上書きしない。Keepはnew contentが完全に一致した場合だけcleanupする。同じPackの追加mutationはrecovery前に拒否する。recovery後も対象Packだけを更新し、他の外部変更を自動Reloadしない。journal記録前にcrashした孤立staging、検証不能なjournal、外部変更のあるbackupはfolderで手動確認する。

## Insertion / D&Dの境界

一覧のinline Insert、右クリックInsert、Command PaletteのInsert Snippet、Pack詳細memberのInsertは同じcommandから`InsertionAdapter`へ入る。直前のtext editorのURI/version/selectionを保持し、assetと共にPhase 3のhandlerへ渡す。**handler未接続の現在は案内を表示するだけで、本文/file/usage countを変更しない。** catalogの`canInsert`はasset eligibilityであり、pipelineの実装完了を意味しない。

dependency/template/mode/conflict/preview、stale target検証、apply/Undoを各UIで個別実装していない。補助D&Dは既定offのPhase 0 demoとして残し、製品一覧から分離して既定非表示にした。実SnippetのD&Dは追加していない。Webview D&D、raw fallback、非公開APIは使用しない。未知の競合やVS Code干渉時に積極的に廃止する方針を維持する。

## 検証

Windows desktopで次を実行した。Hostは個人profileを共有しない。test data/profile/stagingはignoredな`.vscode-test/`配下へ隔離した。

| Check | 結果 |
| --- | --- |
| `npm run test:unit` | 62件成功。core/service/storage/watcher、production webview scriptの送信処理、public repo rules |
| `npm run test:host` | VS Code 1.140.0で25件成功（Phase 2追加10件＋既存15件） |
| `npm test` | 最低対応版1.134.0で同じ25件成功 |
| `npm run compile` / `npm run package` | type / lint / development・production bundle成功 |
| public scan | working tree、staged index、reachable historyを確認。個人path/secret/生成dataの問題なし |

新規追加の主要検証はSelection/File/New captureと保存、Defaultのlazy作成、scope対称copyと原本保持、Pack create/edit・recursive closure、duplicate revision制約、集合delete、cancel/stale token/dirty source、unknown fieldの保持、future Pack byte copy、write/rename failure、journal recovery、自己write抑制とReload/Later。

最終production bundleも`node scripts/run-host-tests.mjs`と`npm test --ignore-scripts`で各25件成功した。空directoryのcopy/edit保持、directory変更のstale検出、長いasset-relative pathでもlibrary/staging prefixが予算を消費しないことをunitで検証した。

実Hostでnative views、中央panel再利用、formのSave/Cancel、source editor、URI filesystemのstaging保存、Insert adapterのtarget captureを実行した。通常editorでの実Save→filesystem watcher→旧snapshot維持→明示Reload→metadata version更新も確認した。production webview scriptはVMでform messageを検証した。新しいmouse D&D実験やComputer Useは行っていない。ボタンを実マウスで一通り押す視覚検証、macOS/Linux/RemoteのHost検証は未実施。CIのLinux/Windows jobは別途結果を確認する。

## Security / 公開

native storageはancestorのsymlink/junction/hardlink・非regular entryを拒否する。pack-scoped staging/backup以外にrecursive deleteしない。ユーザーのコピー元を削除しない。空directoryもtree/fingerprintに含め、copy・metadata編集で保持する。Packは10,000 entries / 128 MiB、通常file 16 MiB、metadata 1 MiB、resolver 256 members / 20,000 candidates / 10,000 search nodes / 2秒を上限とする。Pack組み立て中にもbyte/entry上限を適用する。

URI adapterは公開`workspace.fs`でprivate stagingと`rename(overwrite:false)`を使い、ユーザーsourceをin-placeで書き換えない。local `file` URIでの保存をHostで検証した。public APIではhardlink identity、exclusive write、renameの実装保証を取得できない。Phase 1のURI assetのInsert eligibilityを緩和していない。production UIのwriteはnative local root、`file` URI、VS Code内部の`vscode-userdata`に限定し、未検証の他providerは閲覧のみとする。private providerがfolder window/OS Revealを提供しない場合はsource/raw editorまたはConfigure Global Rootを使う。

Webviewはmediaだけをlocal resource rootにし、CSP `default-src 'none'`、nonce付きlocal script、全asset textのHTML escape、render session tokenとmessageのfield/type/size検証を使用する。未知metadata、preview、候補labelをHTMLやcommandとして実行しない。[公式Webview API](https://code.visualstudio.com/api/extension-guides/webview)、[公式Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view)を確認した。

`.gitignore`とpublic file rulesは入れ子Workspaceの`.snippets`も除外し、意図的なfixtureを残す。source、lockfile、docs、portable IDE設定を保持。tracked files/status/diffを確認し、生成data、node_modules/build/coverage、C# bin/obj、秘密file、個人絶対pathを公開対象に含めない。history rewriteやforce pushは行わない。

## 残る制限・Phase 3前の判断

1. 完成Insertion pipelineは未実装。既存adapterへ統合し、全入口で同じplan/検証/Undoを使う。asset/rootのeligibilityをUI側で迂回しない。
2. URI/private providerの実挿入を有効にする条件は未解決。hardlink/file identityを公開APIで確認できないため、Phase 1の制限を維持する。通常のGlobal rootを設定すればnative gateを利用できる。
3. 通常source editorのSaveはTCP transaction外。versionの自動更新を採用せず、Save→Reload→metadata revision更新とする。source/version更新を一つの明示操作にまとめる導線が必要かは後続UXで判断する。
4. transactionの原子性は一つのPack。multi-Pack copyは順次適用で、途中失敗しても完了済みPackを巻き戻さない。multi-Pack deleteは拒否する。集合全体の原子性が必要ならPhase 4のmulti-Pack transactionとして扱う。
5. 同version/content conflictの比較・replace/fork dialog、ZIP import/export、Clean Copy、C# providerは後続Phase。現状は明示location選択または新規Packで対処し、自動置換しない。

この範囲でPhase 2の「保存→検索→詳細→source edit」「detail panel一つ」「copy原本維持」「Pack自己完結」「依存を壊す削除不可」を満たした。Phase 3開始には利用者の承認が必要。
