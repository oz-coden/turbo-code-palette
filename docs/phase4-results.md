# Phase 4 — ZIP / Conflict / Diff / optional marker

2026-10-09。Phase 4の範囲を実装し、Phase 5へは進んでいない。

## 実装と変更点

全Insert入口は引き続き既存InsertionAdapterと単一pipelineを使用する。target capture → asset/dependency/template/mode/conflict validation → optional preview → target/assets/root/catalog再検証 → applyの順序を維持した。editor edits/resource creation混在planは拒否し、v1が必要とするtransaction/cross-resource Undo保証を現在の公開APIとの組み合わせで実装していない理由をerrorに明示する。mixed transaction/rollbackは追加していない。

新規serviceは`src/storage/archive.ts`と`src/application/packArchive.ts`。既存のdiscovery/metadata/dependency検証を`src/storage/packValidation.ts`で共有し、検証済みtreeのcommitには既存の一Pack transaction/journalを再利用する。`formatVersion`とasset `version`は独立したまま。通常source Save → Reload → metadata revision更新も変更していない。

Packs toolbar/Command PaletteにImport、Pack右クリック/詳細/Command PaletteにExportを追加した。Snippet/Packの右クリックと詳細にCompareを追加した。中央の単一詳細panel、native sidebar、共通Insert入口を維持する。

## Conflict UX / Diff / Preview

| ケース | 判断用の表示 | 適用方針 |
|---|---|---|
| 同UUID/version、異なるcontent | 現在/要求assetのfileを選び標準Diff | Insert/copy/importを停止。自動置換しない |
| existing implementation / export collision | current target全文と要求sourceの標準Diff | textual hitを意味的同一性と解釈せず停止 |
| ambiguous raw-content / session receipt | current targetと要求sourceの標準Diff | 部分一致、編集済みreceiptから互換性を推測しない |
| copy destination revision conflict | incoming/existing revisionのfile Diff | 新Packまたは明示的なmetadata revision更新が必要 |
| Import destination / 他scopeのrevision conflict | preview分類、asset/file Diff | 通常Import拒否、明示whole-Pack Forkのみ可能 |

CompareはVS Code公開command `vscode.diff`とreadonly `tcp-review` TextDocumentContentProviderを使う。自前diff rendererはない。file additions/removalsは空側と比較し、empty-directory差分はdirectory manifestを比較する。binary/non-UTF-8はbyte数とSHA-256のみ表示し、text diffによる内容判断ができないことを明示する。snapshotは最大24件/合計64 MiB、単一text 32 MiB。閉じた後も件数/容量上限またはextension終了までsession memoryに保持する。

current target / requested sourceの比較は編集位置を推測したReplace proposalではない。generic providerは意味解析や既存symbol範囲の推測を増やしていない。既存のplanned content全文previewをreadonly snapshotで維持し、そこからCompareを任意選択できる。Compare後はtargetを再captureせず元URI/version/selectionを再検証する。separate-files previewは新規fileを空内容と比較できる。preview設定は既定OFFで通常Insertに追加stepはない。

Conflict dialogのNew Versionは、loaded/editable assetに限り既存metadata formを開き、明示Saveで新しいrevisionを作る。通常source Saveの自動version更新はない。editor collisionに対する自動Replaceや「比較したので強制Insert」は提供しない。

## Import / Export

`.tcp-sp`はrootの`pack.json`を持つ通常ZIP。root Pack directoryの全file、source、README等のlocal reference、unknown metadataのraw bytes、empty directoriesを保持する。固有のZIP wrapperやscript実行はない。

Importはbounded archive snapshotをdecode/検証 → OSのcanonical temporary directoryにexclusive staging → native readerでstaging identity/hash/metadata/閉包検証 → additions / identical / different-version / conflictsのreadonly preview → 明示action → archive/staging fingerprint、全root/catalogと外部変更を再検証 → 既存一Pack transactionでcommit、という順序。preview/cancelまではlibrary rootを作成・変更しない。destination scope外の同revision conflictもpreviewし、他scopeのidentical Packは選択rootへcopyする。選択rootにidentical Packがあればno-op。

different versionは別Packとして共存する。一Pack内の同Snippet UUID複数versionは禁止を維持する。Fork whole Packは明示確認後にPackと全SnippetのUUIDを新規生成し、既知の内部dependency UUIDをremapする。versions/source/unknown JSON tokenを保持する。unknown fieldやsource文字列にある独自UUID参照は推測して書き換えない旨を確認画面に表示する。

Replace older Packは、同UUIDのより古いPackに対して、変更したSnippetにも新しいrevisionがありmetadata変更規則を満たす場合だけ候補を提示する。選択/確認後の保存は旧treeをrollback用backupへ保持し、成功後に除去する。同version content conflictを強制overwriteするReplace、multi-Pack全体のatomic rollbackはない。

Exportはsource Packを再検証し、固定mtime・regular file/directory modeでZIP化する。OS/userの絶対pathやowner情報はZIP headerへ付与しない。destinationと同directoryのexclusive temporary archiveへ書いてsync/hash検証 → source再検証 → exclusive native hardlink publish → temporary name除去。renameによる既存destinationの黙ったoverwriteを避けるため、hardlinkを作成できないfilesystemでは停止する。完成後はdestinationのみのregular fileとなる。root全体の中へのExportはUIで拒否する。

## Archive security結果

| 検証 | 実装 / tests |
|---|---|
| Zip Slip / absolute / traversal / drive / UNC / backslash / ADS / NUL | raw nameの危険なASCII構文とdecoded name両方を検証。全OSで共通safePaths |
| reserved / trailing dot-space / case / NFC Unicode / duplicate / file-directory | explicit entryとimplicit parentを同じcollision keyで検証 |
| symlink / Unix device / DOS reparse / volume / Unix link extras | external attributesとlink用extra fieldを拒否。staging/archive/rootのnative identity、ancestors、hardlinkも検証 |
| encryption / unsupported method / local header spoof / CRC / size forgery | methodはstored/deflateのみ。local/central name・flag・method・非descriptor CRC/sizeとZIP64 local sizesを比較。actual stream size/CRCを検証 |
| bomb / count / byte / depth | compressed 64 MiB、uncompressed 128 MiB、file 16 MiB、metadata 1 MiB、entries 10,000、depth 64、path 240文字。1 MiB超entryのratio 1,000、stream含むdecode deadline 30秒 |
| malformed metadata / duplicate JSON keys / future schema | strict shared parser。canonical metadata位置を要求し、検証不能future/legacy archiveはUpgrade/repairが必要 |
| UUID / source / reference / dependency | Pack/Snippet UUID重複拒否、source/reference存在・安全性、Pack内閉包と全version constraintを共通resolverで検証 |
| unknown fields | unknown fieldsはdata。巨大number等のtokenをlosslessに保持し、object mergeや実行を行わない |
| stale / cancel / injected failure | archive変更、external root変更、Reload、write failure、rename failure、cleanup failure、recoveryを確認 |

ratio/time guardはdecode streamを対象とする。metadata/catalog検証にworker/process timeoutを追加したものではない。既存のJSON depth/size、全bytes/entries、resolver node/deadline上限も適用する。hostileな別processによるfilesystem差し替えを完全排除するOS transactionとは主張しない。

runtime依存は[yauzl 3.4.0](https://github.com/thejoshwolfe/yauzl) / [yazl 3.3.1](https://github.com/thejoshwolfe/yazl)。readerのsize検証に加えてアプリ自身がCRC/属性/path検証を行う。runtime transitive dependencyを含むlicenseは`THIRD_PARTY_NOTICES.md`へ追加した。依存追加時のnpm auditは0 vulnerabilitiesだった。

## Optional source marker

`turboCodePalette.sourceMarkers`は既定OFF。LanguageProviderのcomment capabilityがある言語だけでBEGIN/ENDの独立したcomment lineを追加する。BEGINはUUID/versionとrendered bodyのSHA-256、ENDはUUID/versionを保持する。出力source自身に含め、hidden workspace provenance DB・自動同期は作らない。

現在のcomment形式はC#/C/C++/Java/JS/TS/JSX/TSX/Go/Rustの`//`、Pythonの`#`。ただし行境界に限定し、target prefixやsourceにquote/backtick/escape/slash/directive/angle bracket等がある場合は安全性を推測せず省略する。JSX/XMLのmarkup contextも保守的に除外する。これはcomment形式の対応一覧であり、各言語のsemantic placement/lexer完全対応ではない。特に通常のcomment/stringを含むfileでは省略されやすい保守的な初期実装。plaintext/JSON/HTML等には他言語のcommentを強制しない。省略はwarningとし、markerなしの既存pipelineで明示確認後に挿入する。

複数sourceのeditor Insertでは一Snippetのrendered bodyを囲む。separate-filesでは各source拡張子から提供可能なcomment形式を選ぶ。単一documentでmarkerとbodyは同じeditor edit/一回Undo。session receiptで確認できる重複のみskipし、markerは単独で互換性証拠にしない。新sessionで同UUIDのmarkerを見つけた場合はbodyが変わっていてもCompareを要求する。

BEGIN/ENDと専用candidate parserにより将来のClean Copyに渡せる設計にした。parserの候補だけで削除してはならず、Clean Copy側で言語contextを確認する必要がある。Clean Copy自体は未実装。

## 実測テスト

- `npm run test:unit`: 103件成功（既存71 + Phase 4追加32）。path/attribute/CRC/size/metadata/閉包/preview分類/Fork/version/rollback/recovery/marker等。
- VS Code 1.140.0、Windows、実Extension Host: 51件成功。
- VS Code 1.134.0、Windows、最低対応版の実Extension Host: 51件成功。
- 両Hostの最終確認は`npm run package`で作ったproduction bundleを使用。標準Diff tabとsnapshot内容、target保持、preview cancel、Conflict evidence、marker OFF/ON・省略・一回Undo・変更body marker停止、source言語ごとの新folder出力、archive roundtrip/Fork/native eligibility、登録commandと詳細buttonを検証。
- GUI Hostを並行起動した一回では最低版のUndo testsが失敗した。window/editor focus競合の影響と推定し、同じbundleを最低版の単独Hostで再実行して51件すべて成功した。GUI Undo検証は各versionを単独実行する。
- .NET標準`System.IO.Compression.ZipFile`でExportした6 entriesのZIPをすべてreadでき、root pack.json一つとempty directoryを確認。
- Replace rename failureでは旧Packの全byte fingerprintを保持しjournalを除去。cleanup failureでは新Packと旧backup/journalを残し、既存Review Interrupted SaveのKeep処理で回復できた。
- 型チェック、lint、production build成功。public repository history scan、tracked files/status/diff/ignore、generated dataの確認を実施。個人path、secret、runtime snippet data、node_modules/build/test outputsは公開対象に含めない。

実Host testsは公開APIで標準Diffを開き、pipeline/serviceとUI登録を検証する。native dialogを実マウスで選ぶ新たなmanual usability試験は行っていない。Computer Useは起動していない。Linux unit CIはpush後に確認し、macOS GUI実測は未実施。

## 残る制約 / Phase boundary

Import/Exportはverified native local rootのみ。private/non-file providerのInsert eligibilityは緩和しない。separate-filesは新規folder publishのみでeditor Undo外。mixed editor/file plan、multi-Pack atomic rollback/cross-resource Undoは未対応。generic structure-awareはplaintextの明示file targetだけでC# semantic placementはPhase 6。

source Save自動version、Clean Copy、Roslyn providerは未実装。D&DはPhase 3で除去した状態を維持する。Import stagingのprocess crash残存はOS temporary directoryの`tcp-import-*`として残り得るが、所有者不明dataの自動削除は追加していない。library内のcommit途中は既存journal/recoveryの対象。Export temporary unlink失敗やpublish後の外部変更はエラーとして報告し、既存archiveを自動削除・overwriteしない。

Phase 5前には、Clean CopyのBEGIN/END除去でどの言語/contextまで安全性を保証するか、現在の保守的marker省略UXを維持するかを決める。安全なlexer/provider拡張は別範囲として扱う。Phase 5への進行には別の承認を待つ。
