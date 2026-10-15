# 手動QAチェックリスト

対象：TCP 0.0.1。**この文書のチェックはすべて未実施から開始します。**
自動テスト成功は実マウス・keyboard・screen reader検証の合格を意味しません。
[開始ガイド](README.md)で隔離runを準備し、生成された`reports/checklist.md`へ結果を記録してください。
この原本を個人path入りの実行記録で上書きしないでください。

## 実行記録・判定方法

```text
日付 / 担当（共有時は一般化）：
ソースcommit / VSIX SHA-256：
VS Code version / commit、TCP version：
OS / architecture、Local / Remote、表示言語：
隔離runの識別子（絶対path不要）：
使用profile：tutorial / lab
C# Provider Status / .NET runtime / Workspace Trust：
支援技術・倍率・keyboard配列（該当時）：
```

- 結果は**未実施 / 合格 / 不合格 / 保留 / 対象外**。対象外・保留にも理由を記録します。
- クリック数は「前提を満たした状態から期待結果まで」の実mouse button押下数（右クリックも含む）です。double clickは2。keyboard操作数は別記します。
- 発見性は**説明を見る前**に入口が見つかったかを記録します。ガイドを読んだ後は「説明参照」とし、未読者と同じ評価にしません。
- 不具合時は各ID、直前操作、error原文、再現率、原本 / clipboard / libraryへの影響を[報告雛形](bug-report.md)へ記録します。
- 以下各項目の「記録」欄を埋めます。直感性は1（迷う）〜5（自然）、復帰は成功 / 失敗 / 不要です。
- shell操作は生成runだけを対象にします。fixture原本・個人libraryへ変更を加えないでください。迷ったら新runからやり直します。

## P0：最初に行う基本フロー（目安45〜60分）

### Q01 インストール・起動・データ隔離

**前提**：新run、生成済みVSIX、既存のdesktop VS Code。通常profileのTCP設定は変更していない。

**操作**：[開始ガイド](README.md)の隔離CLIでインストールしtutorialを開く。ExtensionsでID / version、SettingsでGlobal Rootを確認。TCP Activity Barを開く。

**期待**：0.0.1、空のSnippets / Packs、Clean Copyの3 scope。Global Rootはrun内。通常の個人libraryが出ない。起動時errorなし。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q02 JS Selection → Default Pack → 詳細

**前提**：tutorial、Policy none、attribution none、markers / preview OFF。

**操作**：`examples/greeting.js`のfunctionだけを選択。editor右クリック → **Turbo Code Palette: Create Snippet from Selection** → Workspace → Default Pack。Name `Tutorial Greeting`、Tags `qa` / `tutorial`を設定してSave。

**期待**：SnippetとDefault Packが作られ、選択したfunctionだけを保存。詳細と通常source editorが開く。元fileは不変。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q03 Python / HTMLのCurrent File・New作成

**前提**：tutorial、Q02後。C# Provider disabled。

**操作**：`examples/greeting.py`で**Turbo Code Palette: Create Snippet from Current File**を実行してWorkspaceへSave。次に**Turbo Code Palette: New Snippet**で言語`html`、Source filename `card.html`を指定してSave。通常source editorへ`examples/card.html`の内容をcopyしSave → Reload Library → Edit Metadataで新versionをSave。

**期待**：Pythonは全file capture。Newは空sourceから通常editorで編集できる。HTMLを含む汎用操作に.NET要求がない。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q04 Metadata Form・未知field・編集Cancel

**前提**：labのQA Greeting。変更を他試験へ持ち越したくなければ別run。

**操作**：Edit Metadata。Advancedを開きdescription / tagsを変更、Cancelで中止。同じformを再度開いて変更、提案versionでSave。詳細のMetadata / unknown fieldsを開く。

**期待**：Cancelで変更なし。Save後description / tags / version更新。`qaExtension.preserveMe`と`exports[0].qaHint`が残る。unknown表示は閲覧でありeditorではない。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q05 Pack作成・編集・依存closure

**前提**：labのQA Answer / QA Doubleが初期状態。

**操作**：Create Pack → Workspace、Name `QA Selected`。Search SnippetsでQA Answerを検索 → Search / add → Add → Preview dependency closure → Save。Pack詳細の一覧確認。Edit MetadataでQA DoubleをRemoveしPreview / Saveを試す。

**期待**：QA Doubleが依存として含まれる。必要な依存を壊す削除は拒否し、保存済みPackが不完全にならない。Cancelで復帰できる。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q06 検索・Filter・Favorite・Recent

**前提**：lab。全件表示から開始。

**操作**：Search Snippetsで`tag:qa lang:python` → Apply filter。空queryで解除。`bad:value`のerrorを確認しEsc。QA GreetingをFavoriteし、All / Favorites / Recentを切り替える。詳細表示後Recentも確認。Search Packsも実行する。

**期待**：queryどおり絞り込み、不正queryを全件扱いしない。FavoriteだけがFavoritesに出る。詳細を開いたものもRecentに出る。検索とFilterの両方を解除すると全件に戻る。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q07 Insertの全入口・一回Undo

**前提**：lab。`targets/insert.js`の空行。QA Greeting、標準設定。各試行後にUndoして同じ前提へ戻す。

**操作**：①行inline矢印 ②右クリックInsert → Default Mode ③Command Palette **Turbo Code Palette: Insert Snippet**で選択 ④QA Web ComponentsのPack詳細内Insert。毎回target editorへ戻してUndo一回。

**期待**：4入口とも同じ位置・同じcode、Undo一回で元に戻る。Pack詳細やlibrary sourceへ誤挿入しない。

記録：結果［未実施］／clicks（①②③④）［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q08 Python / HTMLのInsert・Copy・基本Clean

**前提**：lab。QA Python Greeting / QA HTML Card、対応target file、Policy none。

**操作**：それぞれ空行へInsert → Undo一回。Copy to Global → Default Pack。元codeをもう一度Insertし、Clean Copy Current File → Readable → Preview / Untitled document。Escで出力中止。

**期待**：非C#で基本機能が使える。Global locationが増える。Cleanは原本を保持し、HTML commentの無理な除去やminifyをしない。Previewだけではclipboardが変わらない。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q09 Copy：Snippet / Pack、両scope

**前提**：labの専用GlobalはQA用。Q05で作ったPackがあれば利用可能。

**操作**：QA AnswerをCopy to Global → New Pack `QA Global Copy`。Pack全体もCopy to Global。Global locationからCopy to Workspaceを試す（同一groupならlocationを選ぶ）。Versions / locationsを確認。

**期待**：Snippet copyはQA Doubleも含む。Pack copyは全memberを含む。元を保持。同一revision / contentがlocationにまとまり、同一Packへ同一UUIDの複数versionを入れない。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q10 `.tcp-sp`往復：JS / Python / HTML

**前提**：labのQA Web Components、runのexports内に同名archiveがない。

**操作**：Pack Export → `exports/QA-Web.tcp-sp`。WorkspaceへImportしpreview → Import。同じarchiveをGlobalにもImport。Compareを開ける場合はfileを選びDiffを見る。

**期待**：既存Packへはidenticalで変更なし、新libraryへはaddition。3言語・Template・依存・複数source・未知fieldが維持される。元Packは不変。Exportで同名保存を再試行すると上書き拒否。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q11 Clean Copy：3 Preset・全Output

**前提**：labの`targets/insert.js`へQA GreetingをInsert済み。clipboardへ確認用textを手動copyしておく。

**操作**：Selectionを作りReadable → Preview → Esc。Current FileでCompetitive → Preview → Open Untitled document。Current FileでCustom（表示されたtransformだけ選択）→ Clipboard。Readable → Save Asで`lab/clean-result.js`という新規fileを作る。

**期待**：原本不変、Preview中止でclipboard不変。Untitled / Clipboard / 新規fileが各final previewと一致。generic CompetitiveはReadableと同じ安全な範囲。usage countは増えない。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q12 削除・Cancel・依存保護

**前提**：labでDeleteしてよいQA専用copyを作成済み。

**操作**：依存なしSnippetのDelete dialogをCancelし存在確認。再度Deleteで確定。QA Answerと同じWorkspaceのQA-Web Pack内にあるQA Doubleのみの削除を試す（複数locationなら対象を選ぶ）。不要なQA Pack copyも削除する。

**期待**：Cancelで変更なし。選択locationのみ削除され、他copyは残る。依存破壊は拒否。Pack単位の削除は明示確認後。元fixture / 個人libraryへ影響なし。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

## P1：応用・境界条件（目安60〜90分）

破壊的な境界操作は新runを推奨します。Q13〜Q25の結果が相互に影響しないよう、使ったrun識別子を記録してください。

### Q13 Template入力・literal・Cancel

**前提**：labのQA Named Template、空のJS target。

**操作**：InsertしNAME `qaMessage`、VALUE `$&`を選ぶ。Undo一回。再度Insertし入力中Esc。必要ならraw metadataの定義をQA copyで外して、未定義placeholderも試す。

**期待**：同じNAMEが二箇所とも置換され、`$&`はliteral。未解決placeholderを出力しない。Cancelでtarget / usage不変。metadataを変えた試験はSave / Reload / version更新を記録。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q14 再帰依存・既存検証・失敗

**前提**：labのQA Answer / QA Double、空JS target。

**操作**：QA AnswerをInsert。QA Doubleが先であることを確認。変更せず再度Insert。Undoで空へ戻す。別runのQA copyで依存constraintを`=v9.0.0`へ変えSave / ReloadしInsert。

**期待**：依存first、同一検証済みstateへの再Insertは重複させない。適合versionなしでは全体停止、部分codeなし。名前だけの一致を再利用証拠にしない。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q15 cursor / EOF / replace-selection / merge-sources

**前提**：lab。各試行前にtargetを元へ戻す。QA GreetingとQA Two Files。

**操作**：Insert Snippet with Mode…でcursor、end-of-fileを途中位置から試す。置換用textを選択しreplace-selection。QA Two Filesでmerge-sources。各editor Insert後Undo一回。

**期待**：modeの配置どおり。cursorはselectionを削除せず、replaceは範囲を置換。mergeはsources順のtext結合で、importを書き換えない。Undoは一回。未対応modeを勝手に代用しない。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q16 separate-files・Cancel・既存folder拒否

**前提**：lab、通常project editorをactiveにする。`lab/QA-Output`は存在しない。

**操作**：QA Two FilesをInsert → 親folderにlab → folder名QA-Output。`lib/message.js`と`main.js`を確認。同じ名前で再試行。別名でdialogをCancelする試行も行う。

**期待**：新規folderへまとめて作成。既存folderは拒否、Cancelは何も作らない。editor Undoでは削除されないという制約が表示される。libraryへはpublishしない。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q17 mode制約・generic structure-aware・mixed plan

**前提**：新lab。QA copyのみraw編集可能。

**操作**：QA Greetingのinsertへallowed cursor / denied cursorを設定しSave / Reloadしてmode一覧を確認（他の許可modeもなくなる）。次にplaintext targetとtargets `["file"]` / allowed structure-awareの専用QA copyで末尾挿入を試す。最後にQA Answerをcursor、QA Doubleをseparate-filesに設定し、依存付きInsertを試す。

**期待**：denied優先で無許可なら停止。generic構造挿入は明示plaintext fileのみ。JS等を推測しない。mixed planは理由付き拒否、editor / fileとも部分変更なし。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q18 Options・出典・license・markerの独立性

**前提**：labのQA Answer / Double、空JS target、Policy none。

**操作**：Insert Snippet with Options… → Source URLs → TCP identity markersとPreview before applyを選択。Compare → Insert。Source URL / TCP License / TCP BEGIN-ENDを確認しUndo。Full attributionでも試す。attribution None・marker OFFでもnotice保持を試す。

**期待**：依存を含むcanonical URL、Fullなら名前 / version / authors。repository URLはcitationにしない。重複noticeは全文単位で保持。marker設定と独立。Preview中は元不変。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q19 Source Save → Later / Reload → 明示version

**前提**：labのQA Greetingを詳細表示、現在versionを記録。

**操作**：Sources → Open source in editor、返すtextを変更してSave。通知Later、badge確認。Reload Library後、詳細とcode確認。Edit Metadataで新versionをSave。

**期待**：Saveでversion自動増加なし。Laterでcatalog自動reloadなし。Reload後に新内容、form Saveで明示revision更新。未保存sourceがある場合は操作を止め、Save / revert / Reloadで復帰できる。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q20 stale target / assetでapply停止

**前提**：lab。Preview ON、空JS target。

**操作**：QA GreetingのInsert PreviewでCompareを開く。その後のmodeless通知を残したまま元targetを編集し、通知のInsertを押す。別試行ではPreview中にlibrary sourceを別editorでSaveしてからInsertする。

**期待**：古いoffset / sourceへ黙ってapplyしない。停止理由を出し、再選択 / Reload後の新規実行で復帰。自分が加えた編集以外の部分変更なし。modal中に操作できない環境は保留として記録する。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q21 同revision異内容・Diff・解決導線

**前提**：**未編集の新lab**。QA Greetingのversionはv1.0.0。runのvariantsはまだlibrary外。

**操作**：QAウィンドウ外のrepository PowerShellで、開始ガイドの`$qa`をその新runへ設定して次を実行。Reload後QA GreetingのInsertを試しCompare → `greet.js`のDiffを見る。表示される場合はNew Version (metadata form)も確認してCancel。

```powershell
if (Test-Path "$qa/lab/.snippets/QA-Conflict") { throw 'Use a fresh QA run.' }
Copy-Item -LiteralPath "$qa/variants/QA-Conflict" -Destination "$qa/lab/.snippets/QA-Conflict" -Recurse -ErrorAction Stop
```

**期待**：同UUID / version異内容がConflict。Insert停止、標準Diffで相違。自動置換しない。新version導線は明示form、一般Insertに自動Fork / Replaceはない。後続QAは新runで続ける。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q22 export collision・曖昧raw-content一致

**前提**：新labのQA Greeting、JS target。

**操作**：targetへ`// qaGreet`を置いてInsert。Compare後Cancel。別試行でGreetingのQA copyからexportsを外し、source全文をtargetへ通常pasteしてからInsert。

**期待**：genericのtext collisionはcomment一致でも保守的に止まる。raw一致も同一identityと勝手に判断せず比較へ進む。errorが原因と回避策を説明しているか記録する。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q23 ImportのCancel・Fork・revision conflict・不正archive

**前提**：Q10のarchive。別run推奨。runの`invalid-pack.tcp-sp`は意図的な非ZIP text。

**操作**：Import PreviewでEsc、library不変確認。既存Packへ同archiveを再ImportしFork whole Pack → Fork、未知参照warningを確認。Q21のconflict入りlibraryへ元archiveをImportしてCompare、通常Importが出ないことを確認。不正archiveもImportして拒否を確認。

**期待**：Cancel / failureで既存root不変。ForkはPack / SnippetのUUID群を更新し既知dependencyもremap。conflict時は自動Import / Replaceなし。壊れたZIPは検証で拒否しTCPが利用不能にならない。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q24 Clean Copy：出典確認・marker・license

**前提**：lab、Policy none。QA Answerをsource-urls + markerでproject targetへInsert済み。

**操作**：Clean Copy with Attribution… → Source URLs → file。origin pickerではQA Answer / QA Doubleを明示選択。Readable → Preview。marker除去とURL / noticeを確認。別試行でorigin pickerをCancel、またはKeep current text unlinkedを選ぶ場合のwarningも確認。

**期待**：既知URL / notice保持。marker textだけでoriginを推測しない。証明不能なmarker候補は残しwarning。origin Cancelで出力なし。unlinkedは完全性保証ではないと分かる。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q25 Clean Save As・source / library上書き拒否

**前提**：labの合成sourceのみ。clipboardへsentinelをcopyし、原本を退避しておく。

**操作**：Current FileのClean Save Asで元file、既存の別file、`.snippets`内のfileを選ぶ。可能ならQA run内だけに作ったsymlink / hardlink aliasへの保存も試す（作成権限がなければ保留）。途中Cancelも試す。

**期待**：全上書き拒否、既存bytes / clipboard / user state不変。新規filenameなら成功。link未試験を合格としない。OS dialogが先に止めた場合とTCPが拒否した場合を区別する。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q26 generic Dependency Bundleはreview JSON

**前提**：labのJS targetに`qaAnswer()`の参照text、Policy none。

**操作**：Clean Copy → Dependency Bundle → Readable → QA Answerを明示選択 → Preview。Copy / Saveも新規出力で試す。

**期待**：QA Doubleを含むclosure、source URL / notice等を確認できるreview JSON。実行可能なJSのsemantic Bundleと表示しない。候補hitは未検証text、勝手なsymbol解決をしない。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

## P2：optional Provider / Policy・環境・操作性

### Q27 helper無効・利用不可で汎用機能を維持

**前提**：lab Settingsを変更できる。runtimeのインストール / 削除は行わない。

**操作**：C# Providerをdisabled → Developer: Reload Window → C# Provider Status。Q07 / Q08 / Q10 / Q11の主要操作を再試行。C# structure-awareも試し利用不可理由を確認。実際に.NETなし環境が別にあれば同じ試験を行う。

**期待**：汎用管理 / Insert / archive / Cleanは使える。C#高度機能のみ不可。disabled試験を「runtime未導入の実機試験済み」とは記録しない。autoへ戻した後もReload Window。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q28 C# exports・structure-aware・collision

**前提**：既存.NET 10 runtime、trustedなlab、Provider auto。Statusがavailable。不足環境は保留。

**操作**：QA CSharp Depのform Advanced → Detect C# exports with Roslyn、候補確認してCancel。`csharp/namespace.cs`のnamespace領域からDepをInsert → Undo一回。class内部でQA CSharp MemberをInsert → Undo。同名typeや同signature memberが既にあるtargetで再試行。

**期待**：候補は編集確認可能、Cancelはmetadata不変。合法位置へ配置、Undo一回。collision / parse不正では停止し、危険なcursor fallbackなし。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q29 C# Clean・Semantic Dependency Bundle

**前提**：Q28環境、Policy none。

**操作**：`csharp/clean.cs`でReadable / Competitive / Customを比較。Customでordinary / XML docs除去を選ぶ。`csharp/bundle.cs`でDependency Bundle → Readable → C# semantic single-file Bundle → Preview。review JSONの別入口も確認。

**期待**：Source URL / TCP License / string・raw string内marker風textを保持し、許可されたcommentのみ除去。BundleはDepを含むcompile検証済みsyntax plan。曖昧参照や未解決symbolを加えた場合は停止、text連結へfallbackしない。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q30 AtCoder Policyの制約・表示・申告の限界

**前提**：lab、出力は合成データのみ。Q28環境ならC#も対象。fixture URLは実公開証拠ではない。

**操作**：Choose Optional Compliance Policy → AtCoder → start `2026-10-17T21:00:00+09:00`。QA AnswerをInsertし、QA Doubleの公開申告不足で停止することを確認。C# Depは公開申告ありなのでsourceAttribution noneからInsert / Clean Bundleを試し、強制URLとwarningを読む。raw metadataでC# DepのpublishedAtを開始後へ変更してReload、再実行。最後にPolicy Noneへ戻す。

**期待**：不足 / 開始後申告で停止、部分出力なし。申告を満たしてもweb検証・提出保証ではなく、その限界を表示。URL / notice保持。AtCoder中のcomment保護、未知transform拒否。Policy noneへ戻すと通常PresetをAtCoder条件で制約しない。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q31 設定・状態の再起動後保持・Global Root

**前提**：lab。設定変更前の値を記録。run内に空の`global-alternative`を手動作成。

**操作**：Favorite、詳細Recent、成功Insertのcountを記録。Configure Insert Defaultsでattribution / previewを変更。Configure Global Rootで新しいQA folderを選びReload。Reveal / Open Global Library Folderを確認。QAウィンドウを閉じ、同じprofile / extensions引数で再起動。

**期待**：保存した設定・Favorite / Recent / countが残る。新rootへ勝手にasset移動しない。元rootにcopyが残る。検索query / Filterの再起動復元は現状保証しない。元rootへ戻しReloadして復帰できる。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

### Q32 keyboard・Tab・focus・accessibility・error復帰

**前提**：tutorialまたはlab、操作前にkeyboardだけで試す方針を決める。

**操作**：Command Paletteから検索・Insert・createを実行。treeを矢印 / Enter / context keyで操作。Metadata FormをTab / Shift+Tabで巡回し、折り畳み・Save / Cancelへ到達。Template / mode / output pickerをkeyboardで選択・Esc。200% zoomや高contrast、利用できればscreen readerでも読む。空Selection作成等の意図的errorから復帰する。

**期待**：focusを見失わず、label / status / errorを認識できる。mouse専用の主要操作がない。dialog終了後に意図したeditorへ戻れる。Tab trap、読み上げ不備、見切れを記録。screen reader未使用ならその観点は保留。

記録：結果［未実施］／clicks［ ］／keys［ ］／時間［ ］／発見［ ］／直感性［ ］／復帰［ ］／問題・報告ID［ ］

## 環境別・完了判定

同じVSIXを使い、最低対応と手元の現行VS Codeを別runで試します。将来の現行versionを固定値とみなさず、実versionを記録します。
既存Phase 7のCI実績はWindows x64 / Linux x64 / macOS arm64、VS Code 1.134.0 / 1.142.0ですが、これは今回の手動操作結果ではありません。

| 環境 | Q01〜Q12 | Q13〜Q26 | Q27〜Q32 | version・未実施理由 |
| --- | --- | --- | --- | --- |
| Windows x64 / 最低対応 | 未実施 | 未実施 | 未実施 | |
| Windows x64 / 手元の現行 | 未実施 | 未実施 | 未実施 | |
| Linux x64 | 未実施 | 未実施 | 未実施 | |
| macOS arm64 | 未実施 | 未実施 | 未実施 | |
| .NET runtimeが本当にない環境 | 未実施 | 未実施 | 未実施 | disabledによる代用と区別 |
| Remote / WSL / Container / non-file provider | 未実施 | 未実施 | 未実施 | 対応確認済みとしない |

手動では安全に再現しにくいhelper timeout / crash / malformed protocol、全ZIP攻撃matrix、全rollback fault injectionは既存自動テストの対象です。
実runtimeやOSを壊して再現しないでください。通常運用で発生した場合は理由表示・汎用機能への影響・再起動復帰を報告します。

```text
完了時の集計：
  合格 / 不合格 / 保留 / 対象外 / 未実施の件数：
  データ保護に関する重大問題：
  よく使う操作のclicks・時間（create / search / Insert / Pack copy / Clean）：
  説明なしで見つからなかった入口：
  分かりにくいwording・error：
  keyboard / focus / accessibilityの問題：
  再現fixtureと報告ID：
  次回優先する修正・再試験：
```

このQA完了だけで正式公開を実行しません。Marketplace / GitHub Release / version昇格 / license判断は別途です。
