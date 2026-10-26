; ---------------------------------------------------------------------------
; 声屿 · Windows 安装器（支持自定义安装目录）
;
; Electrobun 自带的 `声屿-Setup.exe` 是"每用户自解压器"：固定安装到
; %LOCALAPPDATA%\Programs 下，没有目录选择页，也没有命令行参数可以改路径
; （已核对 ElectrobunConfig 的 win.* 字段与 Setup.exe 内嵌字符串）。
;
; 这个脚本用 Inno Setup 把同一份打包产物做成标准安装向导：
;   · 有"选择目标位置"页（DisableDirPage=no）
;   · 支持"仅为我安装（免管理员）/ 为所有用户安装（Program Files）"
;   · 生成开始菜单、桌面快捷方式与卸载程序
;
; 用法：
;   1) 安装 Inno Setup 6（https://jrsoftware.org/isdl.php）
;   2) 先执行 pnpm desktop:build 产出 build/stable-win-x64/声屿/
;   3) 执行 pnpm desktop:installer
;
; 产物：build/installer/声屿-Setup-Custom.exe
; ---------------------------------------------------------------------------

#define AppName "声屿"
#define AppVersion "0.1.0"
; 由 scripts/installer/build.mjs 通过 /DPayloadDir=... 传入（已解压的应用目录）；
; 直接调用 ISCC 时回退到默认的暂存路径。
#ifndef PayloadDir
  #define PayloadDir "..\..\build\installer\payload\声屿"
#endif
#define AppPublisher "qimiao"
#define AppExeName "launcher.exe"
; 保持稳定：升级安装时沿用同一个 AppId 才能正确覆盖旧版本
#define AppId "{{8F3C2B10-7E4A-4C9D-9C2E-5B1A6D4F7E21}"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
VersionInfoVersion={#AppVersion}

; {autopf}：普通权限下解析为 %LOCALAPPDATA%\Programs（免管理员）
;          提权安装时解析为 C:\Program Files
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
; 关键：允许用户修改安装目录
DisableDirPage=no
UsePreviousAppDir=yes
DirExistsWarning=no

PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64compatible

OutputDir=..\..\build\installer
OutputBaseFilename=声屿-Setup-Custom
SetupIconFile=..\..\assets\app-icon.ico
UninstallDisplayIcon={app}\Resources\app.ico
UninstallDisplayName={#AppName}

Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
AllowNoIcons=yes

[Languages]
; 语言包取自 jrsoftware/issrc（Inno 6.5+），随脚本一起放在本目录，避免依赖安装目录。
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: checkedonce

[Files]
; 必须是「解压后的应用目录」（bin/ Resources/），也就是 Electrobun Setup 安装完
; 的形态；直接装 build/stable-win-x64/声屿（package 形态，Resources 里只有一个
; tar.zst）会让 launcher 误判为安装包不完整。
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\bin\{#AppExeName}"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\bin\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\bin\{#AppExeName}"; Description: "运行 {#AppName}"; Flags: nowait postinstall skipifsilent
