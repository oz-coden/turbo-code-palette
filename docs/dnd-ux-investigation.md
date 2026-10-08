# Phase 0追加調査: editorへのD&D UX

調査日: 2026-10-08（日本時間）。Phase 1の実装は開始していない。技術的な挿入可否と、製品の主操作としての採用判断を分ける。

## 結論と推奨

**公開APIだけでnative TreeViewの通常dropをTCPの挿入処理へ安定して届ける方法は見つからなかった。WebviewViewに置き換えるだけで通常dropが成立することも実証できなかった。** 「あらゆる環境で不可能」という証明ではなく、公開仕様の調査と以下のPoCの結果である。

主操作には明示的な**Insertボタン/command**を推奨する。editorでカーソルを指定し、SnippetのInsertを選ぶ。キーボード利用者にはcommandからの選択・挿入を用意する方針が適する。Shift-required D&Dは、drop位置を直接指定したい利用者向けの補助操作として残せる。Shift-required D&DだけをコアUXとして正式採用することは推奨しない。

この提案で製品UXを確定してはいない。既存demoのclickはpreview、明示Insertは挿入のままとし、今回の比較UIはResearch commandでのみ開く。検索Quick Pickや実Snippetの入力/conflict処理は後続実装の候補であり、今回実装していない。

## Shiftの役割と公開APIの範囲

VS Codeの[1.78 release notes](https://code.visualstudio.com/updates/v1_78#_drop-selector)は、本文へのdrop前にShiftを保持する操作を説明している。これはTCPが割り当てたキーではなく、workbench側の「resourceを開く」操作と「本文へ挿入する」操作の切り替えである。treeで最初からShift+clickすると選択操作と重なるため、demoでは掴んでeditorへ移動してから保持する必要があった。

[公開API reference](https://code.visualstudio.com/api/references/vscode-api#DocumentDropEditProvider)では、providerはdocumentとdrop位置を受け取り、`editor.dropIntoEditor.enabled`が必要とされる。Tree controllerではeditorへのtransferに`text/uri-list`を案内し、tree固有MIMEも自動追加される。公開されたcontroller/providerの引数やmetadataには、Shift要否の上書き・workbenchのdrop経路の強制・任意のeditor DOMのdrop捕捉はない。宣言済みcustom MIMEに変えても、その指定はpayload/provider選択のためであり、操作modifierを選ぶAPIにはならない。

挿入経路に入った後のprovider競合は別問題である。[1.96 release notes](https://code.visualstudio.com/updates/v1_96#_configure-paste-and-drop-behavior)の`editor.dropIntoEditor.preferences`は、edit kindの優先順を指定する設定である。`yieldTo`、provided edit kinds、drop selectorも挿入候補の選択に使う。通常dropでproviderが一度も呼ばれなかった今回の結果は、TCP editが他の候補に負けた結果ではない。preferencesによるShift省略は公開仕様で約束されていない。PoCはpreferencesの既定値`[]`で実施し、その変更によるnativeマウス比較は未実施。

`text/uri-list`のfragmentに書く行・列は参照元URIの位置であり、本文の挿入先を取得する代用品ではない。`TreeItem.resourceUri`を実ファイルにして開かせる方法も、本文への挿入とは異なる。

調査では公開仕様とMicrosoftの[公式drop sample](https://github.com/microsoft/vscode-extension-samples/tree/main/drop-on-document)を参照した。PoCは公開`vscode` API、Webview内の標準HTML drag events、Nodeの公開APIだけを使用する。proposed API、内部command、workbench/Monaco DOMへのアクセス、非公開MIMEの偽装、Shiftイベントの合成、editorの差し替えは使用しない。

controller+provider以外では、標準DOMのplain textを標準editorに渡す候補をPoCで比較したが成功しなかった。公開`TextEditor` APIにはmouse drop/hover位置を直接購読する仕組みがないため、Webviewのdragendやvirtual documentを開くcallbackから「最後のcursorへInsert」を呼ぶ方式は、drop先document/位置や取消しを保証できない。custom editorで自前の編集面とD&Dを作る案は、通常のVS Code text editorを対象とする今回の要件を満たさない。公開snippet contribution/CompletionItemProviderはD&Dを使わないキーボード操作の候補として比較に含める。

## PoCと観測

`Turbo Code Palette: Open D&D UX Lab (Research)`で、固定の合成Snippet、untitled editor、比較用native tree、WebviewViewを開く。製品のGlobal/Workspace Snippet dataには触れない。

nativeはURIのみ、custom MIMEのみ、plain token、custom+URIの4種類。Webview cardはcustom MIME、URI、plain token、plain raw textの4種類。token方式は同一拡張instanceの短命sessionに解決し、通常のcursor/EOF plannerでeditを提案する。raw textは標準文字列dropとの比較用で、TCP providerは受理しない。

| 実験 / Windows 1.140.0 | 証拠 | 結果 |
| --- | --- | --- |
| native URI / custom / plain token / mixed、通常drop | 自動UIによる実drag。各tree drag開始を診断で確認 | editor provider要求0回、対象document不変 |
| Webview custom / URI、通常drop | 自動UIによる実drag。Web側drag開始を確認 | editor provider要求0回、対象document不変 |
| Webview custom、通常dropとdrag中Shift | 利用者が実マウスで比較 | 両方挿入できず。Web側開始は記録されたがeditor provider要求0回 |
| Webview plain raw text、通常drop | 利用者が実マウスで比較 | 挿入できず。Web側開始は記録されたがeditor provider要求0回 |
| native URI、drag中Shift、cursor/EOF、各一回Undo | 前回Phase 0の実Hostで利用者確認 | 成功。追加調査でも既存の肯定証拠として保持 |

最低版1.134.0でも利用者が実マウスで確認した。通常dropは別ファイルとして別tabで開き、drag中Shiftでは本文が変化してUndoで戻った。ただしResearch diagnosticsではTCPの提案は0回、demoコードの出現数も0であった。providerにはURI/plainとともに期待外のcustom transferが届き、PoCが拒否した後に標準文字列挿入が起きた可能性がある。これは観測からの推測であり、transfer配送の原因は未特定である。**本文へdropするmodifier経路の肯定証拠にはするが、Research PoCのTCP Snippet挿入成功とは数えない。** 最低版のWebview custom通常dropの個別結果は、今回の返信では明示されていない。

Webviewの失敗はTCP provider内のsession検証・期限切れ・edit kindの順序による拒否ではない。providerまで到達していない。Webviewのiframe境界をまたぐdrag配送のどの段階で失われたかは、この公開APIからの観測だけでは特定できない。未到達を「providerが呼ばれて拒否した」と記述しない。

Webview間のD&Dを扱うMicrosoftの[issue #111092](https://github.com/microsoft/vscode/issues/111092)にも配送やShiftについての報告がある。ただしこれはeditor向けの保証ではなく、今回の失敗理由を断定する根拠にも使わない。

自動Hostテストは実Extension Host内でcontroller/providerを直接呼ぶものであり、マウスによる経路の成功を証明しない。custom/URI/plain/mixedの提案、raw/未発行/無効session/混合token拒否、正確な位置、EOF、cancel、drop無効設定、Undoを検証する。Undoのテストでは対象text editorに明示的にfocusしてからcommandを実行する。WebviewにfocusしたままのUndoがtext editorのUndoになるとは仮定しない。

## 候補比較

以下の2表は同じ候補を対応させて、要求された観点を比較する。「可能」はAPIで組めることとnativeマウスで実証したことを区別する。

| 候補 | 操作手順 | 公開APIだけで実現 | version / OS portability | 実装複雑度 |
| --- | --- | --- | --- | --- |
| A: native通常drop | 掴む→editorへ移動→release | 安定した本文挿入経路は見つからず | Windows 1.140.0で4 payloadとも未到達。1.134.0ではURIが別tabで開く | 未解決。payload変更だけでは改善せず |
| B: native Shift-required D&D | 掴む→editorへ移動→Shift保持→release | 可。既存controller+provider | Windows 1.140.0のマウス実証済み。最低版Host API検証済み。OS別マウス検証は必要 | 小～中。操作案内と同じ挿入pipelineが必要 |
| C: Webview custom/URI/token D&D | cardを掴む→editorへ移動→release。必要ならdrag中Shift | DOM dragとproviderは公開APIで書けるが、配送成功は未実証 | Windows 1.140.0でcustomは通常/Shiftとも失敗。iframe/Electron/Web/Remote差は未検証 | 中～大。Webview lifecycle、配送、UI、入力検証も必要 |
| D: Webview raw text drop | cardを掴む→editorへ移動→release | 標準DOMだけで書けるが、今回の挿入実証は失敗 | Windows 1.140.0で失敗。他OSへ成功を外挿できない | 単純textは小。ただしTCP機能を失う |
| E: 明示Insert command / button | editorでcursor指定→SnippetのInsert、またはcommandから選択 | 可。既存demo command。Webview buttonも同じcommandを呼ぶ | 通常のeditor編集API。platform modifierを必要としない。native位置指定のOS差を避けやすい | 小～中。target保持と入力pipeline。Webviewを使う場合UI分の負担あり |
| F: native itemのclick-to-insert | editorでcursor指定→itemをactivate | `TreeItem.command`で可能。今回はpreviewを維持し未採用 | native itemのclick/Enter activation。OS別・drag開始との誤操作確認が必要 | 小。ただし選択/previewとの操作設計が必要 |
| G: Webview cardのclick-to-insert | editorでcursor指定→cardをclick | DOM click→検証済みmessage→Insertで可能。PoCには明示buttonを実装 | Webview対応desktopで構成可能。keyboard/assistive technology含め実操作検証が必要 | 中。buttonだけならCより配送リスクが小さい |
| H: 標準snippet / completion | editorでprefix入力→補完を選択 | snippet contribution / CompletionItemProviderで可能。今回未実装 | 通常のeditor入力。OS依存のdrag配送を避ける | 単純textは小。動的なPack機能は追加設計が必要 |

| 候補 | 正確なdrop位置 | Undoのまとまり | template / conflict input統合 | security / maintenance risk |
| --- | --- | --- | --- | --- |
| A | providerまで来れば`Position`を取得。現在未到達 | editを返せればBと同じだが通常dropでは未実証 | 未到達のため使用できず | workaroundで内部形式を使うと高risk。採用しない |
| B | 実drop document/Position。EOFはplannerで末尾へ変更 | cursor/EOF各Ctrl+Z一回を実証 | 非同期provider内で入力を完了してから提案する構成は可能。ただしdialog中のcancel・変更・focus・再選択は追加PoCが必要 | opaque短命session、known source、URI制限。操作条件はVS Codeに依存 |
| C | Webviewのdragend座標からはeditor位置を取得できない。providerが受け取れば正確 | 到達時のAPI編集はHostで一回Undo。native Webview dropでは未実証 | 到達すればBと同じ。ただしmessage受信/dragendで先にInsertするとdrop成功/位置を保証できない | CSP・message検証・HTML escape・session配送・lifecycleの保守が増える |
| D | 標準editor dropの位置。TCPが取得できるとは限らない | 標準挿入のUndoは今回未実証 | TCPを経由しないfallbackではEOF/dependency/template/conflictを統合できない | codeがtransferへ直接出る。誤dropや他appへの配送、検証の迂回を考慮。主操作には不適 |
| E | drop位置は使わない。利用者が指定したcursor/selectionをdocumentとversion付きで保持 | 一回のeditにまとめられる。既存commandの挿入をHost検証。依存込みのUndoは後続PoC | 最も組みやすい。入力/preview/conflictを済ませてから一括編集 | 既知assetのIDだけを受理し、stale targetを再確認。native buttonならWebview面のrisk不要 |
| F | Eと同じcursor。mouse drop位置ではない | Eと同じpipeline | Eと同じ | item選択・preview意図で編集してしまうrisk。誤dragとの区別が弱いためexplicit Insertを優先 |
| G | Eと同じcursor。Webview画面座標をeditor位置へ変換しない | Eと同じpipeline | Eと同じ | CSP/validationは必要。drag配送は不要。明示buttonならclickとpreviewを区別しやすい |
| H | drop位置は不要。補完の適用rangeを使う | 標準snippet編集。TCP固有の複合編集は未検証 | placeholder入力は標準対応。依存/conflictの事前dialogは標準snippet単体では扱えず、明示Insertを併用 | 生textのsnippet構文escapeと、適用後commandによる追加編集/取消しの設計が必要 |

## template / conflictと単一編集の設計材料

どの入口でも、asset選択→target document/version/positionの捕捉→依存解決とconflict/template入力→取消し/版変更の確認→最終plan→一回の編集、という共通pipelineを使う提案とする。入力中にdocumentが変わった場合、古いPositionで黙って挿入せず、再計算/再確認する。

既知のtextと依存追加を一つのDocumentDropEdit/WorkspaceEditへまとめ、入力中は編集しない。複数documentを編集する場合のUndoは別途検証が必要であり、全documentが一回のCtrl+Zで戻ると約束しない。

[公開型定義](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts)上、dropの`insertText`には`SnippetString`も使える。ただし`resolveDocumentDropEdit`で後から埋められるのは`additionalEdit`である。template入力で本文自体が変わるなら、provider提案前に入力を完了するか、明示Insertへ移す必要がある。raw textを挿入してから置換し直す方式は、途中状態・Undo・conflict取消しの扱いが悪くなるため推奨しない。

## 設定、version、OS

- `editor.dropIntoEditor.enabled=true`は挿入provider経路の前提であり、Shiftを不要にする指定ではない。falseは公開API説明とHostテスト上、TCPのdrop提案を無効にする。個人設定はTCPから書き換えない。
- `editor.dropIntoEditor.preferences`と`showDropSelector`は候補選択・表示に関する設定であり、modifierの再割当てではない。
- `editor.dragAndDrop`はeditor内の選択text移動の設定であり、TreeViewのdropを本文に強制配送するAPIとしては扱わない。
- engineは引き続き`^1.134.0`。public API Host連携を1.134.0と1.140.0で検証する。公開release notesではShiftを使う本文dropが以前から説明されており、特定のTCP対応版だけのキー割当てではない。
- 実マウスの肯定証拠はWindows。macOS/Linux、Remote、Webについては実機未検証。公開仕様のShift説明を根拠に案内を作れても、OS別drag配送/Undoの実証とは区別する。
- 最低版の追加自動UI検証では、画面取得toolが複数インストールのwindow識別に失敗した。これをVS Codeのdrop失敗として数えない。

利用者による最低版の結果は上記の通り。URI通常dropが「別tabで開く」点は公開仕様と一致する。Shift後の編集がTCP提案に由来したかは別に検証する必要がある。PoCのmixed transfer拒否は維持し、正常なSnippet挿入に見せるために検証を緩めない。plain token/raw fallbackではTCPの入力/conflictチェックを経由しない編集が起こり得るため、製品payloadには採用しない。

## 再現と検証

```sh
npm run dev:ux
npm run dev:ux:min
```

installed版と最低版はそれぞれignored領域の別profileを使う。Research commandを実行し、同じ空行へまず通常drop、その後drag中Shiftでdropする。native treeの4 payload、cardの4 payloadを個別に選び、diagnosticsの要求/提案回数と実document、Ctrl+Zを比較する。card referenceは2分で失効するため、card側へfocusを戻して更新する。追加UIを再起動/再表示してから比較すること。

```sh
npm run compile
npm run test:unit
npm test
npm run test:host
npm run check-public -- --history
```

型/lint/bundle、単体13件、最低版/installed版それぞれHost integration 17件で検証する。Hostテストは正常な公開DataTransferを直接供給するため、native UIが追加する期待外transferの問題を再現したとは表現しない。raw Host logsにはmachine pathを含む場合があるため、ignored test領域だけに保持する。

研究launcherを使ったときだけ、source/path/tokenを含まない合成targetのdiagnosticsを`.vscode-test/ux-lab-<version>.json`へ記録する。個人設定、screenshots、raw Host logs、test runtime、build outputはcommitしない。Webviewはremote/command URIを使わず、nonce CSP、拡張のmediaに限定したlocalResourceRoots、known message/ID検証を適用する。tokenは短命の参照であり、senderの暗号学的認証ではない。同じtokenを読める別拡張からの再送まで防ぐ機構とは表現しない。

Phase 1へは進まず、主操作をInsertとする提案と、補助D&DとしてShift-required方式を残す選択材料をこの報告で提示する。
