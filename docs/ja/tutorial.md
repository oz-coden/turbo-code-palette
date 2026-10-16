# 20〜30分で試す：JavaScriptのSnippetを作り、共有する

必要なのはVS CodeとTCPのVSIXです。.NET、C# helper、AtCoder Policyは使いません。
[開始ガイド](README.md)の準備スクリプトで作った**tutorial**を開いてください。
TCP libraryが空のWorkspaceから始めます。練習用の通常ファイルだけが既に置かれています。
個人のproject / Global Libraryでは実行しないでください。

Command Paletteは`Ctrl+Shift+P`（macOSでは`Cmd+Shift+P`）です。
TCPは現在英語UIなので、以下の太字はそのまま探せる操作名です。
途中で失敗したら、削除して直そうとせず、[不具合報告](bug-report.md)へ手順を控えてください。

## 1. Workspaceを確認する（1分）

Explorerで`examples/greeting.js`と`targets/insert.js`があり、`.snippets`がまだないことを確認します。
Turbo Code PaletteのSnippets / Packsは空、Clean Copyは3 scopeが表示されます。
Settingsの`turboCodePalette.globalRoot`は、このrunの`global-tutorial`です。

**確認結果**：個人のSnippetが表示されず、Policyがnone、C# Providerがdisabledです。

## 2. コードの一部をSnippetとして保存する（3分）

`examples/greeting.js`を開き、以下のfunction部分だけを選択します。最後の`console.log`は含めません。

```javascript
function greet(name) {
  return `Hello, ${name}!`;
}
```

editor右クリック → **Turbo Code Palette: Create Snippet from Selection**を実行します。
**Choose destination library**で**Workspace 1**（Workspace名も表示）、**Choose destination Pack**で**Default Pack**を選びます。
候補が1つしかないpickerは省略されます。

**確認結果**：中央にCreate Snippet formが開きます。Selectionでcaptureしたcodeを保存する準備ができました。

## 3. 名前・タグを付け、Default Packへ登録する（2分）

Nameを`Tutorial Greeting`、Versionは`v1.0.0`、Descriptionを`練習用のあいさつ関数`とします。
Languagesは`javascript`、Source filenameは`greeting.js`のままです。
**Advanced / optional**を展開し、Tagsへ`qa`と`tutorial`を別々の行で入力します。**Save**を押します。

**確認結果**：WorkspaceのDefault PackとSnippetが作られます。詳細と通常source editorが開きます。
sourceは元projectの参照ではなくlibrary内のcopyです。

## 4. 名前・タグで検索する（2分）

Snippets見出しの虫眼鏡、または**Turbo Code Palette: Search Snippets**を実行します。
`Tutorial`と入力し、**Apply filter (1 items)**行を選びEnterします。修正版では文字を入力してもApply行は消えません。
同じ操作で`tag:tutorial lang:javascript`も試します。
条件候補の選択後も他の種類を追加でき、最後にApply filterで確定します。解除はClear searchです。

**確認結果**：Tutorial Greetingが見つかります。query候補を選んだだけでは確定せず、Apply filterが必要です。
検索を解除するときは入力を空にしてApply filterします。

## 5. 別ファイルへInsertする（2分）

`targets/insert.js`を開き、comment下の空行をクリックします。
SnippetsのTutorial Greetingの矢印（Insert）を押します。

**確認結果**：その空行へfunctionが挿入され、元の`examples/greeting.js`とlibrary sourceは変わりません。
同じ場所へ繰返し挿入すると重複・collisionの検証対象になるため、次のUndoを先に試してください。

## 6. 一回のUndoで戻す（1分）

挿入先editorにfocusを戻し、`Ctrl+Z`（macOSは`Cmd+Z`）を**一回**押します。

**確認結果**：function全体が消え、挿入前のcommentと空行に戻ります。Snippet / Packは消えません。
これはeditorへのInsertです。file作成やlibrary管理のUndoとは異なります。

## 7. metadataを編集する（2分）

Snippetを右クリック → **Turbo Code Palette: Edit Metadata**。
Descriptionを`チュートリアルで更新した関数`へ変えます。Version欄に提案された新version（通常`v1.0.0-0`）を確認して**Save**します。

**確認結果**：詳細と一覧のdescription / versionが変わります。Tagsは維持されます。
元versionを別locationに保持していなければ、編集前のrevisionが別行で残るわけではありません。

## 8. 新しいPackを作る（3分）

Packs見出しの`+`、または**Turbo Code Palette: Create Pack**を実行し、Workspaceを選びます。
Nameを`Tutorial Pack`、Versionを`v1.0.0`にします。
**Search Snippets**へ`Tutorial Greeting` → **Search / add** → 候補の**Add**。
**Preview dependency closure**で1 Snippet / Auto-added: noneを確認し、**Save**します。

**確認結果**：Tutorial Packの詳細にSnippetとInsert buttonが表示されます。
元Default Packにも同じSnippetがあり、同一revision / contentはSnippetsでlogical rowへまとまります。

## 9. Globalへcopyする（2分）

Snippetを右クリック → **Turbo Code Palette: Copy to Global**。
複数locationの選択が出たら作成したWorkspaceのcopyを選びます。
**New Pack**を選び、`Tutorial Global`と入力します。

**確認結果**：詳細のVersions / locationsにglobal locationが増えます。データはrunの`global-tutorial`にあり、個人Globalは変更されません。
既存の任意Packへの追加はCopy pickerではなく、手順8のPack編集のSearch / addを使います。

## 10. PackをExport / Importする（3分）

PacksのTutorial Packを右クリック → **Turbo Code Palette: Export Pack (.tcp-sp)**。
runの`exports`へ`Tutorial-Pack.tcp-sp`という**新規filename**で保存します。
**Turbo Code Palette: Import Pack (.tcp-sp)**を実行し、Workspaceを選び、今のarchiveを選択します。
Previewを読み、**Import**を選びます。

**確認結果**：同じPackが既にあるためidenticalと表示され、重複追加しません。
新規libraryへの追加も試すなら、再度Importして**Global**を選びます。そこにはTutorial Packがないため追加できます。
既存のTutorial GlobalとはPack identityが別です。Fork / Replaceはこのチュートリアルでは不要です。

## 11. Clean CopyのPreviewとClipboard（3分）

`targets/insert.js`を選び直し、空行へTutorial Greetingをもう一度Insertします。
そのeditorを選んだ状態で、sidebarの**Clean Copy → Current File → Readable → Preview / Untitled document**と進みます。
read-only previewを確認し、後続pickerで**Copy to Clipboard**を選びます。
通常の新規Untitled editorを開いてpasteし、previewと同じ内容か確認します。

**確認結果**：元fileは変わらず、clipboardへcopyされています。普通のJSには除去対象がないのでほぼ同じtextになるのが正常です。
HTML / Pythonでも同様に基本操作を試せます。Competitiveはgenericのcode minifyを行いません。

## 次に試すこと

[手動QA](manual-qa.md)のP0を記録し、labへ切り替えてTemplate / dependency / multi-source / Conflictを試します。
所要時間、実クリック数、迷った表記、keyboardで詰まった箇所をrunの`reports/checklist.md`へ記録してください。
このチュートリアル自体の実マウス結果も未記入です。説明どおりにできない箇所は不具合として扱います。
