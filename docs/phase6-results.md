# Phase 6 — optional Roslyn C# provider / attribution preservation

2026-10-15。Phase 6と追加のAtCoder共通要件を実装した。Phase 7・release polish・Marketplace公開には進んでいない。

## Architecture / protocol

`csharp/Tcp.CSharp` (.NET 10 / Microsoft.CodeAnalysis.CSharp 5.0.0、NuGet lockfile付き) をoptional processとして分離した。本体は.NETなしで起動し、従来のgeneric機能を利用できる。helperの自動build/download、workspaceのproject評価・build・MSBuild target・generator・script実行はない。配布packageにhelper binaryを含める方式はまだ確定していない。

machine-scoped `csharpHelperPath`で利用者が信頼したDLLを明示設定し、Reload Windowで有効にする。restricted workspaceでは起動しない。shellを介さずdotnetへ固定引数で起動し、追加startup hooks等の環境変数は継承しない。C# Provider Statusで理由を確認でき、Cancel Current C# Operationで中止できる。helper設定変更後は既存processをdisposeして再起動を要求する。

stdin/stdoutはversion 1のUTF-8 NDJSON。version / request ID / operation / logical input documents / explicit parse options / cancel / diagnostics / structured resultを持つ。stdoutにlogを書かず、stderrはdrainして64 KiBで停止する。clientは同時1件・queueなし、request 8 MiB、response/buffer 16 MiB、timeout 10秒、idle 30秒。helperにも128 documents / 4 Mi UTF-16 characters / depth 64 / symbols 128 / 15秒の上限を設けた。不正shape・version/ID不一致・transport failure・crash・timeoutはprocessを終了しplanを失敗にする。source cacheは置かない。

言語versionは明示setting `csharpLanguageVersion`（例12.0）、preprocessor symbolsは`csharpDefines`。不明時はC# 14 regular document + helper runtime referencesという単体解析条件をdiagnosticに残す。projectのLangVersion/DefineConstants/implicit usings/参照assembly/生成codeは評価しない。latest/previewの推測は拒否する。project/document contextの自動収集は今後の課題。

## Exports / Insert / collision

SyntaxTree / SemanticModelからclass、struct、interface、enum、delegate、method、extension method、property、field、constを候補検出する。helperはaccessibility、namespace/container、signature、generic arityも返す。metadata formのAdvancedにDetect C# exportsとJSON行editorを追加し、候補を追記して利用者が確認・編集する。Save前にmetadataを書かない。formはkind/name/namespace/container/signatureを扱い、既存行のoriginalIndexによりunknown child fields・数値lexemeを保持する。kindはopen stringのまま。

既存の単一Insertion pipelineへC# providerを接続した。全Insert入口は従来どおりadapter/pipelineを共有する。using、block/file-scoped namespace、top-level、enclosing nested/generic type/member、method/statement contextを構文木から判定する。明示insert.targetsに対し、実cursorを包含する構造の合法なboundary候補を検証して最も近いものを使う。statementの途中や文字列の途中へoffsetで分割しない。using targetにはusing directiveだけを受け付ける。targets省略、共通targetなし、同距離で異なる位置、parse error、合法候補なしは停止して明示的な位置/modeの選び直しを案内する。独自のtarget選択dialogは未実装。

複数dependencyのstructure-aware Insertはdependency-first fragmentを共通targetへ配置する。C# structuralとoffset modeの混在は安全側に拒否する。最終documentの単体compilationでnamespace/container/kind/signature/generic arity/overloadに従う衝突・未解決・曖昧bindingを検出し、既存Conflict / VS Code Diffへ送る。同名overloadや異なるnamespaceの同名typeは合法なら許可し、同signature・duplicate type・曖昧partial typeは拒否する。project依存の正常なcodeでも単体参照が足りなければ停止する。

nameやmarkerだけでは既存依存を再利用しない。session receiptによるidentity/content検証、既存UUID/version/content conflict規則は維持した。apply直前のdocument version・asset fingerprints・root/catalog validationも維持。single-documentは一回のeditor.editで適用し、一回のUndoをHostで確認した。mixed editor/file transactionとcross-resource Undoは追加していない。

## Semantic Dependency Bundle

C# helper有効時、Bundle入口でsemantic single-fileと従来のtcp-dependency-review JSONを選べる。semanticではcurrent fileの実symbol referencesを、review済みexports（nameと指定されたnamespace/container/signature）およびsource documentへ対応付ける。文字列/commentの単なる名前一致は参照にしない。root候補からの再帰closure、UUID/version/content conflict、Pack内部依存、SCC/dependency-first順序はPhase 1–5の同じresolver/orderを使う。

closureの構文nodeからsingle compilation unitを構築する。using setの同一性を確認し、compilation-unit usingをまとめ、file-scoped namespaceをblock namespaceへ変換する。top-level statementsを宣言より前へ置き、dependency declarationsはresolver順に置く。usingに付いた出典/header commentとEOF noticeも保持する。元と出力のbound name/signature集合を比較し、単体compilation/Emitを成功条件にする。単純source連結ではない。

保証は**明示されたparse options + helper runtime参照内でのsyntax/binding/Emit成功**。動作全体の等価性や元projectでの成功は保証しない。multiple library revisions/candidates、未解決・曖昧参照、metadata export不一致、欠落依存、異なるusing scopes、directive、extern alias、assembly attributes、依存側top-level statements、CallerLineNumber/CallerFilePathを使う再配置は停止する。公開された選択dialogでの複数候補semantic解消は未実装で、review JSONへ明示的に選び直せる。helper failure時にgeneric連結へfallbackしない。

代表fixtureを生成し、隔離したテストprojectだけをdotnet build・実行して出力42を確認した。製品に元workspace/projectをbuildする機能は追加していない。

## Clean Copy / marker / license

既存registryにasync provider capabilityを加え、capture→ordered transforms→notice/attribution→immutable final plan→preview/outputの流れを維持した。

| Preset | Roslyn有効なC# | helperなし |
|---|---|---|
| Readable | syntax-proven TCP marker pair除去 | 従来の保守的marker証明 |
| Competitive | marker → proven unused using → whitespace normalization | 従来のReadableと同じ処理 |
| Custom | marker / ordinary comments / XML docs / unused using / normalizationから利用可能なもの | 従来provider capabilityのみ |

markerはRoslynの独立SingleLineCommentTrivia、strict identity/version/hash shape、完全なBEGIN/END pair、selection包含を確認する。raw/verbatim/interpolated string、disabled text、directive、orphan/nested/不正version/部分pairは除去しない。markerだけで実装互換性を証明しない。既存のoptional Insert markerは既定OFFのまま、生成は従来の狭い安全範囲を維持した。

通常/XML comment除去は明示Customのみ。literal tokenは触らず、除去triviaを空白化して改行・token境界を保持する。Source URLを含むcomment、file header、既知license-like commentは保持する。ただし法的なnotice分類は保証できないため警告し、AtCoder Policyでは全non-marker commentsを保持する。unused usingは完全document・error-free standalone SemanticModelのCS8019証明があるdirective本体だけを除去し、header/notice triviaを残す。whitespace normalizationは完全なdirective-free/error-free documentに限定し、token streamが変われば停止する。caller infoを使う場合も停止する。

未解決参照があるC#、directive付きCompetitive、部分Selectionでのfile-only transformは拒否する。SelectionのCustom候補からfile-only transformを除外した。unused type/member、rename、modifier shortening、aggressive minification、code golfは未実装。

licenseNotices[].textはexact dedupで常に保持する。C#では構文を確認し、BOMの後・既存header/directivesの前へ安全なline commentsとして付加し、前後token streamも比較する。既存source noticeとの意味的重複は判定・削除しない。selectionに安全なheaderを付けられない場合は出力停止。previewと実出力は同一plan、source/library/aliasへのSave As拒否、新規file限定、cancel/failure時の非変更を維持した。

## AtCoder 2026-10追加要件

[公式の指定commit](https://github.com/atcoder/rules/commit/61500f0afb842798a5ab626725350059540bec04)を確認した。20261014版はABC/ARC/AGC開催中の事前AI生成codeについてWeb事前公開と参照URL添付を要求し、難読化を禁止している。非AIの他者codeの引用推奨とlicense確認は別責任。これに対し旧実装はoptional identity markerとmetadata license保持に限られ、Source URLを最終codeへ付加する共通処理とPolicyがなかった。

今回、Presetから独立したcompliancePolicy（none / atcoder-20261014）と明示atcoderContestStartsAt settingを追加した。通常のPresetをAtCoder用途に固定しない。新規transform IDはPolicy allowlistに明示追加されるまで拒否され、難読化transformを追加しても自動的に有効にならない。現在AtCoder Policyでは安全側にすべてのnon-marker commentsを保持するため、Custom comment除去を指定しても出典・未分類noticeは残る。

出典URLの正本は既存source[].url。repository[]はrepository所在地で、同じURLを別のprovenance URLとして二重保存したり、repositoryを無断でcode引用へ昇格させない。source[].publication / publishedAtはその引用code revisionについての申告、provenance.aiUsageはused / not-used / unknownの申告。open metadata/unknown preservationを維持する。専用の大きなPolicy formは今回追加せずSettingsとraw metadataで扱う。

```json
{
  "provenance": { "aiUsage": "used", "futureEvidence": {} },
  "source": [{
    "url": "https://example.com/public-code/revision",
    "publication": "public",
    "publishedAt": "2026-10-14T00:00:00Z"
  }]
}
```

AI/unknown由来の場合、URL、公表public申告、timezone付き公開時刻が明示contest開始より前であることを要求する。欠落・不正・公開後・不明は停止する。not-used申告でも引用がなければ推奨warningを出す。URLはhttp(s)、credentialなし、改行/controlなしに限定し、件数/総量を制限する。metadataを独立検証していない旨を必ずwarningし、「準拠済み」と表示しない。

InsertionとBundleは各SnippetのURLとSnippet/Pack licenseを収集・exact dedupし、Source URL comments / license commentsへ付加する。これはTCP BEGIN/ENDと別概念で、identity markerがOFFでも適用する。通常Clean Copyも関連assetの出典を保持する。C# helperは構文commentを使ってURLを保持・付加し、string内の偽URLを既存出典とみなさない。同じcanonical Source URL commentが既にある場合は再追加しない。review JSONにもsourceUrls / policy / complianceVerified:falseを含める。

Policy中にmarkerの元metadataが未ロードなら停止する。markerもmetadata関連付けもないcurrent fileは由来を判定できないためwarningを出す。既存URL commentは保持するが、利用者が消した出典や未知の依存を復元・完全検出できない。公開URLが実際に誰でも取得できるか、そのrevisionが指定時刻に公開されていたか、申告されたAI利用/時刻が正しいか、licenseが完全か、コンテストでの利用が許されるかは検証・保証しない。

後続の独立候補はPolicy専用form、contest context入力、URL/revisionの公開証跡・時刻確認と失効/stale扱い、出典欠落のreview UX。これらを未実装のまま準拠済みとして扱わない。コンテスト中に生成AIを利用してよいと示す機能でもない。

## Performance / runtime方式

Windows x64 / SDK 10.0.102 / runtime 10.0.2、Release、同一端末で2回測定。startupは初回Roslyn解析・JIT込み。request loopの中央値であり製品SLAではない。初回と最終補修後で小さい差があり、OS cacheや負荷を統制した比較ではない。計測scriptはscripts/measure-csharp.mjs、raw測定・生成project・publish出力はGit除外領域のみ。

| 項目 | 測定 |
|---|---:|
| framework-dependent cold Snippet | 約463–469 ms |
| warm Snippet (各20 requests) | 中央値1.37–1.40 ms |
| current file 500 types (各5 requests) | 中央値56.1–59.4 ms |
| semantic references (各5 requests) | 中央値2.78–2.89 ms |
| two-source Bundle + Emit (各5 requests) | 中央値10.0–10.4 ms |
| working set（測定系列） | 約138–183 MB |
| managed memory | 約10–28 MB |
| framework-dependent publish | 16,826,489 bytes / 33 files |
| self-contained win-x64 publish | 97,376,869 bytes / 220 files |
| self-contained cold analysis（2回） | 約506–958 ms |
| 本体production JS（最終測定時） | 約226 KB |

framework-dependentは小さいが.NET 10が必要。self-containedはruntime不要にできる代わりにOS/architecture別artifactと約6倍の容量が必要。測定のstartup差だけで優劣は確定しない。現clientはconfigured DLL + installed runtimeで、self-contained apphostの配布/検証/更新UXは今回確定していない。helperをrequestごとに起動せず、idle shutdownで資源を解放する。

## Tests / security / remaining limits

- Roslyn console unit suite: 27件。block/file namespace、top-level、nested/generic、overload/extension/property/field/const、raw/interpolated/verbatim strings、directives、comments/XML、parse error、collision/ambiguous/partial、marker部分/nested/不正、generic construction/reduced extensionのexport対応、reference/Bundle、license/header/using、caller-info拒否を含む。
- TypeScript unit/security suite: 132件。protocol lifecycle/timeout/cancel/crash/malformed/limits、Policy拒否/URL/公開申告、exports losslessness、既存storage/archive/Undo planningの回帰を含む。
- 実Extension Host: 最低1.134.0と比較用1.140.0の隔離版で各74件通過。C# Insert + single Undo、衝突の非apply、async Clean Copy preview、semantic Bundle入口、AtCoder不足時非変更、helper lifecycle/degradation、.NETなし既定activationを含む。標準install版はupdater lockで起動できず、更新処理には触れず同version系の隔離archiveを使用した。途中にUndo focusタイミングの失敗があったが、最終の全件連続runは通過。
- representative generated Bundle: helper Emitに加えdotnet build/実行を通し期待値42を確認。元project/sourceはbuildしない。
- typecheck / lint / production packageを通過。NuGet advisory（transitive含む）とnpm runtime auditは既知脆弱性0。公開前scan・tracked/diff確認を継続し、helper bin/obj、runtime publish、logs、metrics、Global/Workspace生成dataをcommitしない。

今後の制限: project context/reference取得、複雑なusing/extern/directive/partial/file scopeのBundle、semantic候補選択UI、runtime配布・OS別検証、公開日時証跡UI。高度な意味同一性の推測・自動Conflict解消はしない。unknown metadata、formatVersion/version分離、explicit Insert、D&Dなし、source Save→Reload→明示revision、mixed transaction未対応、native local root優先を維持した。
