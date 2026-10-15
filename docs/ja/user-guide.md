# Turbo Code Palette ユーザーガイド

開発版0.0.1の実装に基づく操作ガイドです。[インストール・隔離環境](README.md)を先に確認してください。
Command PaletteはWindows / Linuxで`Ctrl+Shift+P`、macOSで`Cmd+Shift+P`、Undoは`Ctrl+Z` / `Cmd+Z`です。
TCP専用の既定keyboard shortcutは登録されていません。Command Paletteから実行できます。

## 基本：画面とデータ

左の**Turbo Code Palette**にはnative treeの**Snippets / Packs / Clean Copy**があります。
Snippet / Packの行を選ぶと、中央Editor領域の**単一の再利用panel**に詳細が表示されます。
一覧は名前・description・言語・version・scope / Pack等の軽い表示です。code編集はこのpanelでは行いません。

- **Snippet**：UUID、asset version、metadata、1個以上のsourceファイルを持つ再利用単位です。関数・class・断片・HTML・複数ファイル等を扱います。
- **Pack**：Snippetをまとめるdirectoryです。rootに`pack.json`、各Snippet directoryに`snippet.json`とsourceファイルを置きます。依存Snippetも含めます。
- **Workspace Library**：各Workspace folderの`.snippets`です。そのprojectと一緒に保管できます。Gitへ含めるかは利用者が決めます。
- **Global Library**：既定は拡張のstorage内の`snippets`です。`turboCodePalette.globalRoot`で専用ローカルfolderを指定できます。

同じUUID / version / contentが複数locationにある場合はlogical rowへまとまります。
異なるversionは別行です。同じUUID / versionでcontentが異なる場合はConflictです。
**1 Pack内では同一Snippet UUIDの複数versionを保持しません**。異なるPackやlibrary間では共存できます。
Insert / Import / Exportの信頼可能なsourceは検証済みnative local rootです。
private / non-file filesystem providerやfile identityを確認できないrootの操作制限を、別言語Providerで回避することはありません。

詳細ではFeatures、Sourcesのpreview、Versions / locations、Metadata / unknown fields、User stateを確認できます。
Pack詳細では含まれるSnippet名と各**Insert** buttonを表示します。
長いsource previewには上限があるため、全文確認は**Open source in editor**を使います。

## 基本：Snippetを作る

### Selection / Current File / New

1. Selectionの場合は通常editorでコードを選択し、右クリックの**Turbo Code Palette: Create Snippet from Selection**を実行します。
   Command Paletteからも実行できます。空選択はエラーです。
2. ファイル全体なら**Turbo Code Palette: Create Snippet from Current File**を実行します。未保存のeditor内容もcapture対象なので、内容を確認してください。
3. 空のSnippetならSnippets見出しの`+`、または**Turbo Code Palette: New Snippet**を実行します。
4. **Choose destination library**で`Workspace 1`等または`Global`を選びます。候補が1つなら省略されます。
5. **Choose destination Pack**で**Default Pack**または**New Pack**を選びます。New Packでは名前も入力します。
6. 中央のMetadata Formを入力して**Save**します。保存後に詳細へ戻り、新規Snippetのsourceが通常editorで開きます。

作成時にcaptureした内容は、formでcodeとして再編集するものではありません。Cancelならlibraryを変更しません。
Default Packは必要なときに自動作成されます。Packを先に作る必要はありません。

### Metadata Form

「Basic」という名前のtabはありません。上部の基本fieldと、折り畳まれた**Advanced / optional**があります。

| 場所 | field / 操作 | 入力・結果 |
| --- | --- | --- |
| 上部 | Name / Version / Description | 名前、`v1.0.0`形式のasset version、短い説明 |
| Snippet上部 | Languages (one per line) | `javascript`、`python`、`html`等。検索用の言語情報 |
| 新規Snippet | Source filename | captureした内容の保存名。Newの初期値は`code.txt`。JSなら`code.js`等へ変更 |
| 既存Snippet | Sources (existing files, relative to this Snippet) | 既に存在する相対source pathを1行1個。ファイル作成機能ではない |
| Advanced / optional | Tags / Features / Authors | 1行1値。既存author objectの未知fieldは保持 |
| Advanced / optional | Category / Status / Notes | 任意の補足情報 |
| Snippet Advanced | Exports (JSON rows) | exports候補をJSON配列として編集。kindは自由文字列 |
| Snippet Advanced | Dependencies / Search / add dependency | Snippetを検索しAdd、Version constraintを設定、Removeで削除 |
| Advanced内の折り畳み | Other / unknown metadata (preserved) | 元JSONの参照表示。ここはraw JSON editorではない |

Template、`insert` policy、`source[]`、`provenance`、`licenseNotices`等の専用入力formはありません。
詳細の**Open raw metadata**からJSONを編集します。例は応用章にあります。

### metadata・sourceの編集、Reload、version

1. 行を右クリック → **Turbo Code Palette: Edit Metadata**、または詳細の**Edit metadata**を押します。
2. formには次のversion候補が入ります。内容変更には古いversionより新しい値が必要です。**Save**で更新します。
3. codeは詳細の**Sources**を展開 → **Open source in editor**から通常editorで編集してSaveします。
4. 外部変更通知の**Reload**、または**Turbo Code Palette: Reload Library**を実行します。
5. source内容をrevisionとして確定するときは再びMetadata Formでversionを明示更新してSaveします。

通常Saveだけでversionは上がりません。`Save → Reload → metadata revision更新`が現在の手順です。
Reload前のcatalogや、未保存のlibrary editorを使った操作は停止する場合があります。保存またはrevertし、Reloadして選び直します。
raw metadataを直接編集した場合もSave後にReloadしてください。

`formatVersion`はTCP schema version、`version`はSnippet / Packのrevisionです。
意味を変えないformat migrationにasset version増加は不要です。旧formatの**Upgrade format** / **Turbo Code Palette: Upgrade Metadata Format**で対応します。
未知の将来formatはread-onlyです。
TCPのversionは`vMAJOR.MIDDLE.MINOR[-PATCH]`で、例えば`v1.0.0 < v1.0.0-0 < v1.0.0-1 < v1.0.1`です。
`-0`はnpm SemVerのprereleaseとは異なります。通常はformの候補を利用できます。

### 削除

行の右クリック → **Turbo Code Palette: Delete**、または詳細の**Delete**を選び、対象scope / Packを確認して**Delete**を明示します。
他locationのcopyは残ります。必要な依存を壊すSnippet削除は拒否されます。
一括削除は同一Packのmemberが対象です。削除はeditor Undoの対象とは考えず、QA用データで試してください。

## 基本：Packを作る・編集する

1. Packs見出しの`+`、または**Turbo Code Palette: Create Pack**を実行しlibraryを選びます。
2. 名前・version・descriptionを入力します。**Search Snippets**へ名前や`tag:qa`を入力し、**Search / add**を押します。
3. 候補の**Add**を押します。**Preview dependency closure**で自動追加される依存を確認します。
4. **Save**すると選択Snippetと依存closureを持つPackになります。元Snippetのlocationは残ります。
5. 既存Packの**Edit metadata**も同じformです。**Remove**でmemberを除き、Preview後にSaveします。

必要な依存を壊す削除や、1 Pack内の同じUUIDの複数versionは拒否されます。
一般のSnippet Copyの行き先pickerは**Default Pack / New Pack**です。既存の任意Packへ追加したい場合は、このPack編集のSearch / addを使います。

## 基本：検索・Favorite・Recent

1. Snippetsの虫眼鏡、または**Turbo Code Palette: Search Snippets**を実行します。Pack検索は**Turbo Code Palette: Search Packs**です。
2. queryを入力し、先頭の**Apply filter (N items)**を選んでEnterすると、sidebarへfilterが適用されます。
   modifier候補を選ぶとqueryへ追加されるため、最後にApply filterを実行します。
3. filter解除は同じ検索で入力を空にし、Apply filterを実行します。Escだけでは前のfilterを解除しません。
4. 行の右クリック **Turbo Code Palette: Toggle Favorite**、または詳細の**Favorite / Unfavorite**で切り替えます。
5. 見出しのfilter、または**Turbo Code Palette: All / Favorites / Recent**で**All / Favorites / Recent**を選びます。両treeへ適用され、検索queryとの組合せになります。

```text
greeting lang:javascript
tag:qa scope:workspace
pack:"QA Web Components"
version:">=v1.0.0 <v2.0.0"
```

modifierは`lang` / `tag` / `category` / `pack` / `scope` / `version` / `author` / `feature`です。不正なqueryはエラーとなり、無条件検索に切り替わりません。
Favorite / Recent / usage countはasset metadataではなくprofileのuser stateです。
**Recentは詳細表示でも更新されます**。usage countはInsert完全成功時だけ増えます。Cancel、Previewのみ、Clean Copyでは増えません。
検索queryやAll等の表示filterの再起動後復元は実装されていません。Favorite / Recent / countの保存とは区別します。

## 基本：Insert

### 入口と共通フロー

まず挿入先の通常text editorでcursor / selectionを決めます。次のどの入口も同じInsertion pipelineです。

- Snippets行の矢印の**Insert**。
- Snippet右クリック → **Insert → Default Mode / Choose Mode… / Turbo Code Palette: Insert Snippet with Options…**。
- Command Paletteの**Turbo Code Palette: Insert Snippet** / **Turbo Code Palette: Insert Snippet with Mode…** / **Turbo Code Palette: Insert Snippet with Options…**。
- Snippet詳細の**Insert / Insert with Options…**、Pack詳細の各Snippetの**Insert**。

target capture → asset検証 → 依存解決 → template入力 → mode / placement → collision検証 → 任意preview → target / asset再検証 → applyの順です。
入力中にtargetやlibraryが変わるとstaleとして停止します。挿入先を確認して最初から実行し直してください。
依存・template・preview・conflictがなければ通常Insertに毎回Options dialogは出ません。D&Dは製品導線ではありません。

### Insert Mode（配置方法）

**Turbo Code Palette: Insert Snippet with Mode…**で利用可能なmodeを選べます。
metadataの`allowedModes` / `deniedModes`を反映し、deniedが優先されます。

| Mode | 動作 | 制約・確認 |
| --- | --- | --- |
| `cursor` | captureしたactive cursor位置へ挿入 | 選択範囲を消さない |
| `end-of-file` | document末尾へ挿入 | cursor位置に依存しない |
| `replace-selection` | captureしたselectionを置換 | 対象範囲を確認。空選択では位置への挿入になる |
| `merge-sources` | `sources`の順に改行でつなぎcursorへ挿入 | import修正やsemanticなcode統合はしない |
| `separate-files` | 選んだWorkspace内の親folderの**新規folder**へsource群をpublish | 既存folderへの追加・上書きは不可。新規folder名も入力する |
| `structure-aware` | 対応Providerが証明できる位置へ挿入 | genericは`plaintext`かつtargetsが`["file"]`の末尾のみ。JS / Python / HTMLの構造推測はしない。C#は応用章 |

単一documentへのInsertは一回のUndoを想定し、Hostテスト済みです。実マウス・keyboardでの確認は手動QA欄へ記録します。
新規folder / file publishはeditor Undoの対象外です。確認後、不要なら作成したQA folderを手動管理します。
editor editとfile creationが混在するplanは拒否します。途中の部分変更は行いません。

### Insert Options（配置と独立）

**Insert Snippet with Options…**は**Source attribution**を選び、その後marker / previewを複数選択します。
modeはassetのdefaultを使います。modeとOptionsを同時に選ぶ単一dialogではありません。
特定modeとOptionsを組み合わせる場合はDefault設定を変更して**Insert Snippet with Mode…**を利用できます。

| Option | 内容 |
| --- | --- |
| None (`none`) | 出典を新規付加しない。License Noticeの保持とは別 |
| Source URLs (`source-urls`) | metadataの正本`source[].url`をcommentへ出力。依存のURLも含む |
| Full attribution (`full`) | URLに加えSnippet名・version・authorsを出力 |
| TCP identity markers | UUID / versionのBEGIN / END。出典コメントとは独立。既定OFF |
| Preview before apply | apply前の最終planを表示。既定OFF |

**Turbo Code Palette: Configure Insert Defaults**はSource Attribution設定を開きます。
SettingsでSource Attribution / Source Markers / Preview Before Insertを保存し、次のInsertにも使えます。
`repository[]`やhomepageをSource URLへ自動昇格しません。出典・licenseを安全なcomment形式・位置へ付加できなければ停止します。
identity markerだけは安全に付けられなければ省略してwarningを表示します。
必要なlicense noticeはattribution `none`でも別に扱います。

Previewでは元targetは変わりません。**Compare**でVS Code標準Diff、**Insert**でapply、Cancel / Escで中止します。
Diffは左が現在、右が計画内容です。複数fileなら比較するfileを選びます。

### Template・依存

sourceの`{{NAME}}`が入力になります。同一Snippetの複数source内でも同名は一つの値です。
`templateVariables`のdefault / required / description / optionsを反映し、未定義のplaceholderはrequired入力になります。
replacementはliteral one-passです。値の言語構文エスケープを自動生成する機能ではないため、Previewで結果を確認してください。
未解決placeholderが残る場合は停止します。入力途中のEscでは変更しません。

dependencyはUUIDと全version constraintで解決し、name mismatchはwarningです。Workspace優先で候補を探しますが、既存Packの依存はPack内で解決します。
再帰依存はdependency-firstの安定順、cycleは安定順で扱います。
検証済みの既存実装は再利用できますが、名前・marker・部分text一致だけで同一とは断定しません。適合候補なし・曖昧・content conflictでは停止します。

## 基本：Copy・Import / Export・Conflict

### Global ↔ Workspace

1. SnippetまたはPackを右クリック → **Turbo Code Palette: Copy to Global** / **Turbo Code Palette: Copy to Workspace**。詳細にも対応するbuttonがあります。
2. Workspaceが複数なら行き先を選びます。Snippetなら**Default Pack / New Pack**、New Packなら名前も選びます。
3. Snippetは必要な依存もcopyします。PackはPack全体をcopyします。元は変更しません。
4. 同一revision・同一contentはlocationとしてまとまり、異なるversionは別行になります。必要ならVersions / locationsで保存先を確認します。

複数Pack選択の操作は全Pack一括rollbackを保証しません。まず単一Packで試してください。

### `.tcp-sp`で共有

1. Packを右クリック → **Turbo Code Palette: Export Pack (.tcp-sp)**、または詳細の**Export .tcp-sp**。
2. library外の**存在しない新規filename**へ保存します。既存archiveは上書きしません。
3. **Turbo Code Palette: Import Pack (.tcp-sp)**、またはPacks見出しのImportから、行き先libraryとarchiveを選びます。
4. Previewで`addition` / `identical` / `different-version` / `conflict`を確認します。
5. **Compare**で既存と比較、**Import**で追加、Escで中止。完全identicalの場合は変更しません。
6. 必要な場合のみ**Fork whole Pack**で新UUID群へ明示fork、または表示条件を満たす**Replace older Pack**で旧Packを明示置換します。確認dialogも読みます。

形式はrootに`pack.json`がある通常ZIPです。Zip Slip、非portable path、link、重複entry、size / count、metadata・依存closure等を検証し、staging完了までlibraryを変更しません。
Forkは既知の内部依存IDを更新しますが、未知field中の独自参照までは解釈しません。利用者の確認が必要です。

### Conflictと復帰

同一UUID / versionの異内容、export名collision、曖昧な既存実装、copy / import先revision conflict等は自動置換しません。
通知で**Compare**を選び、fileを選択して標準Diffで確認します。
対象を編集できる場合は**New Version (metadata form)**も出ます。formでrevisionを明示更新できます。
通常Insertの一般的なReplace / Fork解決UIはありません。code・metadata・targetを修正しReload後、再実行します。
Pack Importのwhole-Pack Fork / 条件付きReplaceとは区別してください。

### 外部変更とReload

外部Saveは**Reload / Later**通知を出し、自動reloadしません。
Laterなら現在のcatalogを維持し、変更pendingのbadgeが付きます。後で**Turbo Code Palette: Reload Library**を実行します。
library root変更後もReloadが必要です。エラー時に個人データを消して復旧しようとせず、対象・未保存editor・pending変更を確認します。

## 基本：Clean Copy

原本を書き換えず、変換したcopyを作ります。挿入先ではなく、copy元editorを最初に選びます。

1. Selectionならtextを選択します。sidebarのClean Copyから**Selection / Current File / Dependency Bundle**を選びます。
   **Turbo Code Palette: Clean Copy**でもscope pickerを開けます。
2. **Readable / Competitive / Custom**を選びます。Customは現在のProviderで利用可能な変換だけを複数選択します。
3. warningがあれば内容を確認します。**Continue**以外では出力しません。
4. 次の3候補から選びます。UntitledはPreview後のpickerにあります。

| pickerの表記 | 結果 |
| --- | --- |
| Clipboard | final planをclipboardへcopy |
| Preview / Untitled document | read-only previewを開いた後、Copy to Clipboard / Open Untitled document / Save Asを選ぶ |
| Save As | 新規fileへ保存。原本・library asset・alias / symlink経由の原本・既存fileへは上書きしない |

Previewと実出力は同じfinal planです。Previewを見ただけでclipboardは更新されません。
入力中に元document / catalog / root / policyが変わると停止します。
Cancel / failureではclipboard / file / usage countを更新しません。

| Preset | generic Provider | optional C# Roslyn |
| --- | --- | --- |
| Readable | 安全な独立commentと証明できるTCP markerのみ除去。HTML等はtext保持 | syntax-aware marker除去 |
| Competitive | Readableと同じ安全な範囲。minifyではない | 証明可能なunused using除去、whitespace normalizationを追加 |
| Custom | 提供されるtransformだけ選択 | marker、ordinary comments、XML docs、unused using、normalization等、条件を満たすもの |

string / raw string / template literal等と区別できないmarker候補は保持しwarningにします。
generic comment除去、rename、unused member削除、code golf、危険なminifyは行いません。
Selectionでは一部の全document変換が利用できません。C# parse / semantic条件不足時の無理なfallbackもありません。

### 出典・License NoticeとBundle

**Turbo Code Palette: Clean Copy with Attribution…**でSource attributionを選び、その後`selection / file / bundle`を選択します。
library内のsourceなら物理locationでoriginを確認できます。
通常editorのoriginを確定できない場合、**Confirm current text origins for attribution**で実際のSnippet群を選ぶか、
**Keep current text unlinked**を明示します。両方を混ぜられません。markerや似たtextだけでは出典を推測しません。
必要な由来を網羅できないときはunlinkedを「保持保証」として扱わないでください。

`licenseNotices[].text`は既知のnoticeを全文単位で重複排除して保持します。notice内の繰返し行は消しません。
Source URL、TCP identity marker、license noticeは別概念です。marker除去は出典・licenseの除去を意味しません。
安全なcomment再付与ができなければ停止します。TCPはnoticeを法的に除去可能か判断しません。

genericの**Dependency Bundle**はSnippetを明示選択し、共有resolverでclosureを集めた**review JSON**です。
text上のexport hitは候補表示に過ぎず、semantic bindingでも実行可能な結合codeでもありません。
実行可能なC# Bundleは応用章を参照してください。

## 基本：設定とGlobal Libraryへのアクセス

Settings (`Ctrl+,` / `Cmd+,`)で`@ext:oz-coden.turbo-code-palette`を検索します。
設定JSONでは以下の正式IDを使います。Global Root / helper設定はextension host側のmachine設定です。

| 設定ID | 既定 | 用途 |
| --- | --- | --- |
| `turboCodePalette.globalRoot` | 空文字 | 空なら内部storage。任意の絶対ローカルfolderへ変更可。データ移動はしない。変更後Reload Library |
| `turboCodePalette.sourceAttribution` | `none` | `none` / `source-urls` / `full`。Insert / Clean Copyのdefault |
| `turboCodePalette.sourceMarkers` | `false` | Insert identity markers |
| `turboCodePalette.previewBeforeInsert` | `false` | Insert preview |
| `turboCodePalette.compliancePolicy` | `none` | 任意Policy。Presetとは別 |
| `turboCodePalette.atcoderContestStartsAt` | 空文字 | optional Policy用timezone付き開始日時 |
| `turboCodePalette.csharpProvider` | `auto` | `auto` / `disabled` / `custom` |
| `turboCodePalette.csharpHelperPath` | 空文字 | custom時だけのadvanced DLL指定。通常不要 |
| `turboCodePalette.csharpLanguageVersion` | 空文字 | 明示C# version。空はstandalone C#14 |
| `turboCodePalette.csharpDefines` | `[]` | 明示preprocessor symbols |
| `turboCodePalette.showDevelopmentDemos` | `false` | 過去の開発demo。通常QAでは使用しない |

**Turbo Code Palette: Configure Global Root**はfolder pickerです。選択後Reload Libraryを実行します。
**Turbo Code Palette: Open Global Library Folder**は別windowでfolderを開き、**Turbo Code Palette: Reveal Global Library**はOSで表示します。
内部storageも利用者がアクセス可能な資産です。root変更前にバックアップし、元rootのcopyを失わないようにしてください。
C#設定の変更後は**Developer: Reload Window**が必要です。Policy / attributionの通常設定変更は次の操作へ反映されます。

## 応用：raw JSON・unknown fields・複数source

詳細の**Open raw metadata**から`snippet.json` / `pack.json`を通常editorで開けます。
schema補完は編集支援であり、実行時のpath / dependency / identity検証の代用ではありません。
不要なJSON全体の再生成はせず、未知fieldを残してください。formの既存exports行では`originalIndex`を保持すると未知child fieldを維持できます。
unknown fieldは構造編集で保持されますが、利用者がraw editorで消したものを復元する機能ではありません。

Snippetの例です。`sources`は保存file、`source`は由来URLです。次のUUIDは説明用なので実データのidentityへ流用せず、QAのコピーで試します。

```json
{
  "formatVersion": 1,
  "id": "72000000-0000-4000-8000-000000000001",
  "name": "Named message",
  "version": "v1.0.0",
  "languages": ["javascript"],
  "sources": ["message.js"],
  "tags": ["message"],
  "templateVariables": [
    { "name": "NAME", "required": true, "default": "message", "description": "Identifier" },
    { "name": "VALUE", "options": ["hello", "world"], "default": "hello" }
  ],
  "exports": [{ "kind": "function", "name": "buildMessage", "customField": true }],
  "dependencies": [
    { "id": "72000000-0000-4000-8000-000000000002", "name": "Helper", "version": ">=v1.0.0 <v2.0.0" }
  ],
  "insert": { "defaultMode": "cursor", "deniedModes": ["replace-selection"] },
  "source": [{ "url": "https://example.com/synthetic/message" }],
  "licenseNotices": [{ "text": "Synthetic notice for QA only." }],
  "customTeamData": { "preserve": true }
}
```

```javascript
function buildMessage() {
  const {{NAME}} = "{{VALUE}}";
  return {{NAME}};
}
```

この例の依存Helperは別途同じPack内に必要です。code例とexportsは説明用なので実際の公開symbolへ合わせて編集します。
version constraintはcanonical TCP versionへの`=` / `>` / `>=` / `<` / `<=`のANDです。省略は任意version、空文字や不正構文は停止です。
Template名は英字または`_`から始まる英数字 / `_`です。

複数sourceの作成は、まず1 sourceでSaveし、Snippet directoryへ通常fileを追加してから、既存formの**Sources**またはraw JSONの`sources`へ相対pathを登録します。
例：`["lib/message.js", "main.js"]`。Save / Reload / 明示version更新の手順を守ります。
専用の複数file capture wizardはありません。absolute / traversal / link等は使用できません。
`separate-files`はsourceの相対pathを新規folder内へ保ちます。`sourceOverrides`は保持・表示のみで、source別override実行は未対応です。

## 応用：C# Roslyn Provider

VSIXにはframework-dependent helperが同梱されます。既存.NET 10 runtimeとWorkspace Trustがあれば`auto`で発見し、通常はDLL path入力不要です。
**Turbo Code Palette: C# Provider Status**で利用可否と理由を確認します。
無効化、runtime不足、timeout、crash、protocol mismatch等でも汎用TCPは利用できます。semantic処理をgeneric推測で代用しません。
**Turbo Code Palette: Cancel Current C# Operation**で進行中のhelper操作をcancelできます。

### Exports候補と構造挿入

- C# metadata formのAdvancedで**Detect C# exports with Roslyn**を押し、class / struct / interface / enum / delegate / method / extension method / property / field / const等の候補を確認・編集してSaveします。
- `insert.targets`に`using` / `namespace` / `top-level` / `type` / `member` / `statement`等の対応contextを指定し、`structure-aware`を使います。対応値はProviderの制限に従います。
- block / file-scoped namespace、type / member / statement等をsyntaxで判定し、現在位置に近い合法targetを選びます。parse不正や曖昧な配置は停止します。
- overload / signature / container等を検証しますが、symbol名・markerだけで同一実装とは断定しません。ConflictならDiffで確認します。

既定はstandalone C#14です。projectのcsproj / MSBuild / generator / scriptは実行しません。
必要ならLanguage Version / Definesを明示しReload Windowします。外部assembly等が不足するsemantic操作は成功扱いにしません。
試験用`csharp/namespace.cs`のnamespace領域では**QA CSharp Dep**、class内部では**QA CSharp Member**を使えます。

### Semantic Dependency BundleとClean Copy

`csharp/bundle.cs`の`System.Console.WriteLine(Dep.Answer);`を開き、Clean Copy → Dependency Bundle → Preset → **C# semantic single-file Bundle**へ進みます。
SemanticModelの参照からknown exportsへ対応付け、通常のmetadata resolverでclosureを取得します。
using / namespace / declaration等をsyntax-awareに構成し、standaloneのcompile validationを通ったplanを出力します。
任意projectの完全なbuild再現、全libraryの自動収集、外部参照不足の推測補完は保証しません。
未解決・曖昧・unsupported directive等はdiagnostic / 停止で、単純連結へfallbackしません。review JSONの入口は残ります。

C# Custom Clean Copyではsyntax-aware ordinary / XML comment除去等を選べます。
string / verbatim / raw / interpolated string内のmarker風textは残し、安全な独立comment markerのみ除去します。
unused usingは不要と証明できるcontextでのみ処理します。Source URL / 認識済みnoticeはcomment除去から保護し、notice再付与もsyntax-awareに行います。
任意の自然言語license本文を完全に自動識別する保証はありません。metadataと出力の両方を確認してください。

## 応用：任意のAtCoder Policy

通常のReadable / Competitive / CustomはAtCoderの規定を前提にしません。Policyの既定は**none**です。
必要なときだけ**Turbo Code Palette: Choose Optional Compliance Policy** → **AtCoder ABC/ARC/AGC — 2026-10-14**を選びます。
contest startは`2026-10-17T21:00:00+09:00`等のtimezone付きISO 8601で入力します。None — general useで戻せます。

基準は[2026-10-14の公式変更](https://github.com/atcoder/rules/commit/61500f0afb842798a5ab626725350059540bec04)です。
TCPが確認するのは**metadataの申告と保持条件**です。AI / unknown由来では全citationにURL・public申告・開始より前のpublishedAtが必要で、不足時は停止します。
Source attributionがnoneでもPolicyがURL付加を強制し、その変更をwarningで表示します。未知 / 未review / 難読化transformは許可しません。
保守的に非marker commentを保護するため、Customでcomment除去を選んでも残る場合があります。

```json
{
  "provenance": { "aiUsage": "used" },
  "source": [{
    "url": "https://example.com/synthetic/published-code",
    "publication": "public",
    "publishedAt": "2026-10-01T00:00:00Z"
  }]
}
```

これは**架空のデータ形式例**です。実Web公開や開始前公開の証明ではありません。
公開日時の独立確認、AI申告の真偽、全由来の網羅、license義務、提出適格性はTCPが保証しません。
他人がAIなしで書いたcodeの引用推奨や難読化禁止を含め、実際の利用前に公式規定・実コードの公開証拠・licenseを本人が確認してください。
markerを付けたこと、warningをContinueしたこと、出力できたことを「準拠済み」と考えないでください。
