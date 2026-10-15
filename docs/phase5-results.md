# Phase 5 — 安全側に限定したClean Copy

2026-10-15。Phase 5を実装した。Phase 6には進んでいない。

## 基本UXと共通plan

TCP native sidebarにClean Copy sectionを追加し、Selection / Current File / Dependency Bundleの3行から操作できる。Command PaletteのClean Copyでも同じserviceを使う。scope開始時に直前の有効なfile/untitled text editorのURI、version、selection、全text、languageをcaptureし、入力中にfocusが変わってもrecaptureしない。空Selectionや古いcaptureは拒否する。

Preset → Custom選択（必要な場合）→ notice/source/asset検証 → immutable final plan → warnings確認 → Output、の順。OutputはClipboard / Preview・Untitled / Save As。previewはreadonly `tcp-review` documentで、そのまま同じplanからClipboard / Untitled / Save Asへ進める。閉じればclipboard/fileへの出力はしない。Untitledは原本と別documentを作る。

planはtext・scope・preset・transform順序・notice・warningを固定しfreezeする。previewだけ別の変換を実行することはない。VS Codeのpreview/Untitled bufferがEOL等をnormalizeし、plan textと一致しない場合も停止する。入力は16 MiB、最終出力は32 MiB。NUL/binaryとlossless UTF-8化できないsplit surrogate Selectionは拒否する。

## 実装したtransformとPreset

`src/core/clean/`が順序pipeline、`src/language/cleanProvider.ts`がcapability/transform登録、`src/application/cleanCopy.ts`がcapture/validation/output、`cleanBundle.ts`がreview構築、`src/storage/cleanOutput.ts`が新規file publishを担当する。

| Preset | 現在の有効処理 | 保持するもの |
|---|---|---|
| Readable | 対応providerのproven TCP marker comment内容除去 → notice保持/安全な再付与 | code、通常comment、改行、indentation、空白 |
| Competitive | 現在はReadableと同じ | minificationやcode golfを期待させない説明をUIに表示 |
| Custom | 現在のprovider capabilityで利用可能なtransformだけを選択。未選択も可能 → notice保持 | notice除去は提供しない |

未対応言語はmarker変換なしのtext copy。選択しなかったmarkerや処理不能candidateは残してwarningする。CustomのBundleではcurrent fileと全sourceのproviderで共通に利用できるtransformだけを提示する。利用不能IDやcapability欠落はerrorであり、regex fallbackしない。

一般comment/XML doc除去、unused using/import/type/member除去、identifier rename、modifier shortening、whitespace minification、code golfは一つも実装していない。順序付きtransformと明示capabilityのregistryにより、Phase 6で信頼できるproviderが実装を追加できる。新しいproviderの登録/解除もgenerationでcaptureし、途中変更はstaleとして中止する。

## TCP markerの保証範囲

Phase 4 BEGIN/END形式をstrict JSONで読み、UUID/version、BEGIN hashの形式、既知keyだけであること、matching pairを確認する。hashはbodyの互換性保証として使わない。pair両端が安全な独立comment lineで、Selectionに両端の全内容が含まれる場合だけ、そのcomment内容を除去する。**改行はそのまま残す**ため、lineを結合したりcodeのline numberingを詰めたりしない。

現在のproviderはC#/C/C++/Java/JS/TS/JSX/TSX/Go/Rustの`//`とPythonの`#`を狭く扱う。document先頭からquote、backtick、escape、slash、directive、angle bracket、特殊Unicode改行、ordinary comment/pragma等の不確実要素が現れたら、そこでcontext証明を打ち切り、その後は再開しない。有効な独立TCP marker行自身だけは既知のcommentとして扱える。indented marker、malformed/duplicate-key/unknown-key、orphan、nested、部分Selectionのpairは残す。

string/raw string/verbatim/interpolated/template literal、markup、block comment、Java Unicode preprocessing、C continuation/trigraph等をparserなしで解釈して安全と推定しない。これらのfixtureではcandidateを保持してwarningする。C#完全syntax-aware処理は未実装で、Phase 6 Roslyn providerの責務。削除はregexによる一般comment除去ではなく、providerが証明したprotocol行のoffsetに限定する。

## License notices

関連するloaded Snippet/Packの`licenseNotices[].text`を収集し、string完全一致でdeduplicateする。文字、改行表現、unknown metadataを勝手に正規化しない。malformed noticeは修正を要求し、黙って捨てない。上限はdistinct notice 10,000件/1 MiB。

Selection/Fileではlibrary file identityとmarker候補のUUID/versionを収集の手掛かりにする。Selectionがmatching pairの中身だけでもmetadata収集の対象となる。markerはoriginの確証ではないため、余分なnoticeを保守的に収集する場合がある。libraryから対応metadataを得られなければwarningし、既存source commentは保持する。TCPがlicenseの適用関係や法的除去可否を判断するものではない。

全Presetでnotice保持を必須にした。code textへ再付与する場合はLanguageProviderの`license-comment-header` capabilityを要求し、独立した行comment headerとして付ける。block commentでwrapしない。fragmentの開始context、shebang/BOM、Python encoding cookie、Java escape/C trigraph、Go build directive、特殊改行/control等に対して安全なheaderを提供できなければ**出力を停止**する。未対応言語へC# commentを強制しない。既存の通常license commentを解析して削除/dedupする処理もないため、元のcommentとmetadata再付与が重複することはある。

Bundle reviewではnoticeをJSONの`licenseNotices` arrayへ一度ずつ収め、code内へcommentを捏造しない。元source textに含まれる通常noticeもそのまま残す。noticeを除去する設定や法的判定は追加していない。

## Dependency Bundleの実際の保証

**Phase 5の出力はreview JSONで、実行可能なmerged codeではない。** `.json`、`format: tcp-dependency-review`、`executable: false`とUI/warningで区別する。current fileと各Snippet sourceを別entryで保持し、asset UUID/versionとsource-relative nameを付ける。絶対source URIはmanifestへ付与しない。templateはraw source dataとして保持し、template入力やcompile可能性を保証しない。

generic段階のknown export検出はmetadataのexport nameのtext hitだけで、string/comment内のhitも含み得る。confirmed referenceは一件も自動採用せず、全caseを明示的なSnippet/location選択へ回す。no-hit、ambiguous、unresolvedもsemantic解決できたとは主張しない。参照を確定して必要なcodeだけを自動抽出する機能はPhase 6へ残す。

選択した各Snippetの依存はそのPack内部で既存`resolveClosure`を使って解決し、同じresolverでclosure同士を検証してから既存SCC/dependency-first順に並べる。別の依存解決ロジックはない。missing dependency、unsatisfied constraint、同一UUIDの複数version、同UUID/version different contentは停止する。Pack内部に依存がなければ他libraryの似た候補へ黙ってfallbackしない。Workspace/Global/locationは利用者が明示選択し、Pack内部優先を維持する。

existing implementation/export collisionについてもInsertionの保守的checkerを診断に再利用するが、JSON内のsourceをmerge/replace/dedupしない。current fileに既に含まれた実装を意味的に検出して除去することもない。Bundleは最大10,000 files、serializing中の概算31 MiB/最終32 MiBで停止し、無制限にsourceを蓄積しない。

## Output safety

出力直前にsource document version/text、root設定、catalog snapshot、provider generationを再確認する。関連asset/Packのfingerprint・native identityとfresh catalogのrevision conflictも検証する。preview中の編集やReload、外部source変更、root/provider変更で停止する。dirty library source等について既存のguardを緩和しない。

Save Asはnative local filesystemの**新規filenameだけ**。source URI、absolute projected Untitled source、case/NFC Unicode alias、library root内を拒否する。既存destinationは種類を問わず拒否するため、sourceへのhardlink/symlinkも上書きできない。ancestorのsymlink/junction/reparse/nonregularを既存safePathsで拒否する。

明示Save As後、destinationと同directoryのexclusive `.tcp-clean-UUID.tmp`へUTF-8書き込み/sync → byte/identity検証 → source/assetsとdestination再検証 → synchronous stale check → exclusive hardlink publish → owned temp名除去。既存fileへのrename overwriteはない。hardlink不可のfilesystemでは未対応error。write/stale/publish failureはユーザーfileを変更せず、所有するtempだけを除去する。publish成功後のtemp cleanup failureは、既に成功した出力を失敗扱いにせずwarningする。process crashやOS cleanup failureではowned tempが残る可能性があり、自動的に他者dataを削除しない。

Clipboardは全validation/入力の後、一度だけ公開APIへ最終textを渡す。cancel、validation failure、previewのみでClipboard writeを呼ばない。OS Clipboard API自体の失敗後の副作用をTCPがtransaction保証するものではなく、失敗時に古いClipboardを自動restoreして他appの更新を上書きする処理も追加していない。Clipboard/Untitled/Save Asには同じplan textを渡す。Clean Copyはusage、recent、favorites、asset metadata、source versionを一切更新しない。

## Tests / security

- unit全体125件成功（既存103 + Phase 5追加22）。BundleのJSON escape拡大も累積size上限で拒否する。
- Windows VS Code 1.140.0の実Extension Host: 66件成功（既存51 + Phase 5追加15）。
- Windows VS Code 1.134.0最低対応版の実Extension Host: 66件成功。同じproduction bundle、GUIは単独で順次実行。
- 最低版の追加確認で既存Phase 0のcursor Undo testにfocus/変更通知同期の揺れが出たため、そのhistorical API fixtureの2 testsは対象editorへfocusし、一回だけUndoを発行してdocument変更通知を待つよう修正した。製品D&DやUndo実装は変更していない。
- native section/command、Selection/Fileのcapture、原本text/version/dirty flag、同じplanのreadonly Preview/Clipboard/Untitled/Save As、native Clipboard API roundtrip、cancel、stale document/assets/root/provider、notice/marker、Bundle JSON、source/alias/library保護を検証。
- Clipboard実測testは以前の値をmemory内で保持し、他appによる更新がなければrestoreする。値をreport/logへ出力しない。source/user-stateの非変更も確認。
- core filesystem testsはwrite failure、stale、競合writer、hardlink、junction/symlink、case/Unicode collisionで原本保持とowned scratch cleanupを検証。
- 型チェック、lint、production build成功。公開前のworking/staged/history scan、tracked files/status/diff、ignoreと生成dataを確認する。新しいruntime依存なし。test data/outputは既存`.vscode-test/`、`.tmp/`、`*.tmp`等のignore対象で、必要なsource/docs/fixtureを過剰ignoreしない。

Host testsはinput/output選択をinteraction portから制御し、実VS Code document/preview/clipboard/filesystemを使用する。native pickerを実マウスで押す新たなmanual usability試験はしていない。Computer Useは起動していない。Linux unit/Windows Host CIはpush後に確認する。macOS GUI実測は未実施。

## Phase 6前の未解決事項

- RoslynでC#のfull syntax/semantic marker判定、reference/export mapping、compile可能なBundle構築を行う際のlanguage version、runtime、parse error/cancel/ambiguous bindingの契約。
- Readable/Competitiveの差別化は、安全性を明示保証するprovider transformが実装された後に限定する。genericなminify/unused除去は追加しない。
- comment処理が現在省略される範囲、fragmentへのnotice再付与停止、既存noticeとmetadata noticeの重複をsyntax providerでどこまで扱うか。
- read-only generic review JSONを維持しつつ、将来のsemantic providerが実行可能code planを返すUI/検証を別途設計する。既存resolver/identity規則は継続利用する。

mixed editor/file Insert transaction、private/non-file Insert eligibility、source Save自動version、generic structure-aware拡張、D&D復活は実装していない。Phase 6は別途承認を待つ。
