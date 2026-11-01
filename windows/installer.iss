#ifndef AppVersion
#define AppVersion "0.6.0"
#endif
[Setup]
AppId={{44DBCB6A-20A4-4D82-A4CC-600C46336B1F}
AppName=Assisted Writer
AppVersion={#AppVersion}
AppPublisher=Assisted Writer
DefaultDirName={localappdata}\Programs\Assisted Writer
DefaultGroupName=Assisted Writer
OutputDir=..\build\installers
OutputBaseFilename=AssistedWriter-{#AppVersion}-windows-setup
SetupIconFile=runner\resources\app_icon.ico
UninstallDisplayIcon={app}\assisted_writer.exe
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=yes
[Files]
Source: "..\build\windows\x64\runner\Release\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\Assisted Writer"; Filename: "{app}\assisted_writer.exe"
[Run]
Filename: "{app}\assisted_writer.exe"; Description: "Open Assisted Writer"; Flags: nowait
