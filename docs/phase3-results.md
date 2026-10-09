# Phase 3 — 共通Insertion pipeline

2026-10-09（日本時間）。Phase 2承認後の追加指示を実装。Phase 4には進まない。通常source Save → 明示Reload → metadata revision更新の方針、schema/asset versionの独立、安全なnative root優先を維持する。

## UXとflow

一覧Inline Insert、右クリックInsert、Command PaletteのInsert Snippet、Pack詳細memberのInsertは、共通command → `InsertionAdapter` → `InsertionPipeline`へ入る。右クリック/Command Paletteの**Insert Snippet with Mode…**は同じadapterへ`choose`要求を渡し、実行時に使えるmodeだけをQuickPickで提示する。UIにsource置換・依存・apply処理を追加していない。

1. **target capture**: Snippet選択より前に、直前の有効file/untitled editorのURI/version/selectionを固定する。Webview focusでtargetを失わない。複数cursorは現在未対応。targetがclosed/stale、library自身のsourceの場合は停止。
2. **asset validation**: native local root、usableなPack、supported metadata、source/path/file identityを検証。dirty library source/metadataは既存service guardで拒否。private/non-file/URI readerのeligibilityを緩めない。
3. **dependency resolution**: UUIDと全version constraintsで解決。既存Pack内部に限定し、他PackのWorkspace/Globalから不足を黙って補わない。共通resolverの候補優先はWorkspace → Global（Pack構築・copy等で適用）。適合候補なし、同revision content conflict、不正Packでは停止。name mismatchはwarning、Continue/Cancelを要求する。
4. **template input**: dependency-firstにSnippetごとに入力。全sourceの同名variableを一度だけ尋ねる。別Snippetの同名は別値。入力中はeditor/outputへ変更しない。
5. **mode/placement**: denied → allowed → provider/target能力。各dependencyは自分の設定を使用する。defaultが使えなければ明示選択し、cursorへ黙ってfallbackしない。
6. **collision/duplicate**: 同UUID/versionの異内容はlocationを選んでも停止。exportsの名前をtarget textと比較し、疑わしいhitやbatch内の同名を拒否する。raw sourceの完全一致も互換性を推測せず「ambiguous existing implementation」として停止。
7. **optional preview**: `turboCodePalette.previewBeforeInsert`（既定false）で計画済みの最終textまたは新規file一覧をuntitled plaintext editorへ表示。Insert/Cancel。preview自体はtarget、output、usage/recentを変更しない。
8. **再検証**: loaded snapshot identity、root configuration、全使用asset/親Packのdisk fingerprint、他rootで現れた同revision conflict、target URI/version/textを再確認。入力/preview中の変更で停止し、再度位置を選んでInsertする。
9. **atomic apply**: 一つのTextEditor.editに全editor editsをまとめる。同offsetはdependency-firstで一editへ合成し、重複rangeは拒否。file出力は後述の新規folder方式。成功後だけ実際に挿入したSnippetのusage/recentを更新する。

templateの名前はcase-sensitive `[A-Za-z_][A-Za-z0-9_]*`。metadataのdefaultは入力初期値、required/description/optionsを解釈する。未定義placeholderはrequired。optional/defaultなしは明示空文字を許す。重複定義、不正options/default、required空値、invalid placeholder、置換後のplaceholder残存は停止する。callbackによるliteral one-pass置換で`$&`、`$1`、backslash等を特別扱いしない。replacementが別placeholderを含む場合は再展開せず拒否する。展開sourceには上限を置き、巨大replacementによるメモリ増加を抑える。

## modeの範囲

| mode | Phase 3の実装 |
| --- | --- |
| cursor | captureしたactive cursorへliteral text。複数sourcesはmetadata順でEOLを挟む |
| end-of-file | captureしたdocumentの末尾へ |
| replace-selection | captureしたselection rangeを置換。複数の重複replaceは拒否 |
| merge-sources | metadata sources順のliteral連結をcursorへ。意味的merge/using整理ではない |
| structure-aware | generic providerで安全な**plaintext + 明示targets:["file"]**のみ。document末尾へ。他言語/構造は使える代替modeを明示選択する |
| separate-files | native workspace内の既存parentを選び、**新しいfolder**へsourcesの相対pathを保持して作成。既存folder/fileへの追加・上書きはしない |

`sourceOverrides`は原文保持・詳細表示のみで、Insert時に未適用warningを出す。高度なC# namespace/type/member/using配置、Roslyn、意味的mergeはPhase 6。generic providerはcode構造をregex等で推測しない。exportsの文字列hitは停止理由としてのみ用い、解析成功や同一実装の証明には用いない。

## 既存依存とconflictの限界

SCCはTarjanで求め、component内はUUID順、component間はdependency-firstで安定順にする。diamondで共有される依存は一回。別placementを指定したassetの物理的な位置は各modeに従うが、同位置の内容順と入力順はdependency-firstとなる。

成功したtext insertionには**session内だけの検証cache**を保持する。documentの確認済みtext、UUID/version/content、挿入bodyが一致する場合だけ依存/本体を省略する。依存は、同versionの異内容を除外し、確認済みの別versionがすべてのincoming constraintを満たす場合も省略する。その既存依存だけが必要とするbranchを新たに挿入しない。明示選択した本体revisionは勝手に別versionへ替えない。Undo/Redoで確認済みsnapshotに戻った場合も照合できる。source/template入力は省略したassetについて再実行せず、既に確認した実装を使用する。再挿入の意図が異なるtemplate値による別実装なら、自動重複を許す操作として扱わず後続conflict判断を必要とする。

既存bodyを置換/内部編集した場合、確認不能なUUIDを後続の無関係な挿入で忘れない。未知の編集後は安全側で停止する。cacheは32 documents / 8 snapshots per document / text概算64 MiBを上限とし、永続DBやsource markerは作らない。reload-window/cache eviction/別sessionの任意コードからUUIDや互換versionを確実に復元することはできない。完全一致のraw codeはambiguousとして停止し、metadata exportsの衝突を保守的に拒否する。

generic段階では、exportsに未記載で、内容も改変された任意の既存コードのsymbol/UUIDを完全検出できない。comment/stringにあるnameも保守的なcollisionとして停止することがある。意味的scope/signatureの判定や既存実装の選択・比較・replace/forkはPhase 4/6へ残す。互換性を名前一致だけで証明して依存を省略することはしない。

## Apply / Undo / failureの実測

[公開WorkspaceEdit API](https://code.visualstudio.com/api/references/vscode-api#workspace.applyEdit)ではtext-onlyはall-or-nothing、resource creationを含むeditは一つのfailureで残りを中断する仕様。複数file作成を一括APIに渡すだけでrollback保証とは扱わない。

単一documentはcaptured editorを再取得した後、最終再検証して**一回のTextEditor.edit**（undoStopBefore/After=true）でapply。依存/SCC/複数source/cursor/EOF/replace-selection/merge-sourcesは実Hostで**一回のUndoで全文復元**を確認した。成功履歴のusageはUndoで減算しない。

separate-filesはapply開始後だけ、選択parentの直下にexclusiveな`.tcp-insert-UUID`を作る。boundedなexclusive write/sync、staging treeのbytes/entries/links検証、target/assets再検証、既存destination再確認の後、一つのdirectory renameで完成folderを公開する。途中write failure/stale/destination conflictではowned stagingだけを片付け、target editorや既存fileを変更しない。競合processが作ったdestinationは保持する。sourceのfile/directory/case/Unicode/path衝突、traversal/ADS/reserved names、links/hardlinksを拒否する。

**file作成はeditor Undoの対象外。** 一回のUndoを試しても出力fileが残ることを両Host版で実測した。不要な出力folderの除去は利用者が明示的に行う。resource operationsとeditor editsの混在planはv1で拒否する。全dependencyをtext系またはseparate-files系の対応設定に揃える必要がある。複数既存documentへの構造編集は提供しない。

native filesystemのhostileな同時差し替えを完全排除するOS-level transactionとは主張しない。process crashで公開前stagingが残る場合は手動確認する。通常failureのcleanupが失敗した場合もprivate stagingを保持し、既存user dataを削除しない。新しい耐久recovery/Undo UIや混在planの補償transactionは後続判断とする。

## 検証と公開安全性

Windows desktop、隔離profile/新規workspaceで検証。テストassets・出力・cache/profileはignoredな`.vscode-test/`配下。個人settings/Global dataを使用しない。新規Computer Use接続や実mouse操作はしていない。

| Check | 結果 |
| --- | --- |
| unit | 71件成功（新規9件）。mode precedence、SCC/diamond、resolver conflict/Workspace優先、templates/literal/上限、collision、overlap、native file publish/途中write failure/stale/競合destination原本保持 |
| production Extension Host | 最低対応1.134.0 / 現行1.140.0で各43件成功（Phase 3追加18件＋既存25件） |
| build | type/lint、development/production bundle成功 |
| public scan | working/index/reachable historyをscanし、status/tracked files/diffをreview。個人絶対path/secret/生成dataを公開対象に含めない |

Hostは全入口の実handler、template跨source/跨Snippet、cancel/invalid option/mode/output、document/asset/catalog/root stale、dependency再利用と編集後の拒否、SCC/diamond、symbol/raw/content conflict、URI制約、separate-files非上書き・target不変・途中failure、Undoを確認。QuickInputの入力/選択/previewの応答は共通interaction portで決定的に与え、mouseで全buttonを押した視覚確認とは区別する。macOS/Linux/Remote Hostは未実施。CIはLinux/Windowsのunit/build/public scanとWindows最低Hostを別途確認する。

`.gitignore`と公開file rulesに`.tcp-insert-*`を追加した。user workspaceのgitignoreを自動変更する機能は追加していない。生成したreportにローカル絶対pathを入れず、source/lockfile/portable config/必要fixtureは維持する。history rewrite/force pushは行わない。

## Phase 4前に判断が必要な事項

1. 混在editor/file planとmulti-document operationsを、耐久journal/rollback/明示Undo UIで拡張するか。現在のfail-closedな制約を保つ場合も利用者への案内は必要。
2. markerやLanguageProviderによるsessionをまたぐ既存実装検証を追加するか。曖昧な場合はConflict comparison/replace/fork UIへ接続し、推測による重複省略をしない。
3. previewのdiff表示、対象editor/locationの分かりやすい表示、conflictの保守的なfalse-positive解消導線。現在は最終全文/新規file内容を表示する。
4. generic structure-awareの狭い能力を維持し、C#の高度providerは予定どおりPhase 6へ送る。URI/private providerのInsert eligibilityは維持。

ZIP、Clean Copy、multi-Pack rollback、source Save時の自動version更新、Roslynは本phaseで実装していない。Phase 4へ自動では進まない。
