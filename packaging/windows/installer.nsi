; Built by scripts/package.mjs, with platform-specific payloads and MODE supplied.
Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "Sections.nsh"
Name "Reqora ${VERSION} (${MODE})"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Reqora"
InstallDirRegKey HKCU "Software\Reqora" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "Install the Reqora desktop client, browser UI, or both.$\r$\n$\r$\nThe Web UI includes its local request engine and runtime. No separate Node.js or Docker installation is needed.$\r$\n$\r$\nClose Reqora before upgrading or changing components."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${PAYLOAD}\LICENSE"
!if "${MODE}" == "both"
  InstType "Desktop only"
  InstType "Web UI only"
  InstType "Desktop and Web UI"
  InstType /NOCUSTOM
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE CheckComponents
  !insertmacro MUI_PAGE_COMPONENTS
!endif
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE CheckDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Launch Reqora"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchReqora
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "English"

Section "-Prepare"
  SetShellVarContext current
  Call CheckDirectory
  IfFileExists "$INSTDIR\.reqora-install" 0 fresh
    nsExec::ExecToLog '"$INSTDIR\web\runtime\node.exe" "$INSTDIR\web\cli.mjs" stop'
    Pop $0
    ClearErrors
    IfFileExists "$INSTDIR\desktop\*.*" 0 +2
      RMDir /r "$INSTDIR\desktop"
    IfFileExists "$INSTDIR\web\*.*" 0 +2
      RMDir /r "$INSTDIR\web"
    IfErrors 0 fresh
      MessageBox MB_ICONSTOP "Close all Reqora windows and try the installer again."
      Abort
  fresh:
  Delete "$SMPROGRAMS\Reqora\Reqora Desktop.lnk"
  Delete "$SMPROGRAMS\Reqora\Reqora Web.lnk"
  Delete "$SMPROGRAMS\Reqora\Stop Reqora Web.lnk"
  SetOutPath "$INSTDIR"
  File "${PAYLOAD}\LICENSE"
  File "${PAYLOAD}\NOTICE.txt"
  File /oname=reqora.ico "${ICON}"
  File "${PAYLOAD}\reqora-run.cmd"
  FileOpen $0 "$INSTDIR\.reqora-install" w
  FileWrite $0 "reqora-install-v1"
  FileClose $0
SectionEnd

!if "${MODE}" != "web"
Section "Desktop client" Desktop
  !if "${MODE}" == "both"
    SectionIn 1 3
  !else
    SectionIn RO
  !endif
  SetOutPath "$INSTDIR\desktop"
  File /r "${PAYLOAD}\desktop\*"
  CreateDirectory "$SMPROGRAMS\Reqora"
  CreateShortcut "$SMPROGRAMS\Reqora\Reqora Desktop.lnk" "$INSTDIR\desktop\reqora.exe"
SectionEnd
!endif

!if "${MODE}" != "desktop"
Section "Web UI and local request engine" Web
  !if "${MODE}" == "both"
    SectionIn 2 3
  !else
    SectionIn RO
  !endif
  SetOutPath "$INSTDIR\web"
  File /r "${PAYLOAD}\web\*"
  CreateDirectory "$SMPROGRAMS\Reqora"
  CreateShortcut "$SMPROGRAMS\Reqora\Reqora Web.lnk" "$INSTDIR\web\runtime\node.exe" '$\"$INSTDIR\web\cli.mjs$\" open' "$INSTDIR\reqora.ico"
  CreateShortcut "$SMPROGRAMS\Reqora\Stop Reqora Web.lnk" "$INSTDIR\web\runtime\node.exe" '$\"$INSTDIR\web\cli.mjs$\" stop' "$INSTDIR\reqora.ico"
SectionEnd
!endif

Section "-Register"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Reqora\Uninstall Reqora.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Reqora" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Reqora" "DisplayName" "Reqora"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Reqora" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Reqora" "DisplayIcon" "$INSTDIR\reqora.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Reqora" "Publisher" "Ajith"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Reqora" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Reqora" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Reqora" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Reqora" "NoRepair" 1
SectionEnd

Function .onInit
  !if "${MODE}" == "both"
    SetCurInstType 2
  !endif
FunctionEnd

!if "${MODE}" == "both"
  Function CheckComponents
    ${IfNot} ${SectionIsSelected} ${Desktop}
    ${AndIfNot} ${SectionIsSelected} ${Web}
      MessageBox MB_ICONSTOP "Select at least one component."
      Abort
    ${EndIf}
  FunctionEnd
!endif

Function CheckDirectory
  IfFileExists "$INSTDIR\*.*" 0 accepted
  IfFileExists "$INSTDIR\.reqora-install" 0 unrelated
  FileOpen $0 "$INSTDIR\.reqora-install" r
  FileRead $0 $1
  FileClose $0
  StrCmp $1 "reqora-install-v1" accepted unrelated
  unrelated:
    MessageBox MB_ICONSTOP "Choose an empty folder or an existing Reqora installation."
    Abort
  accepted:
FunctionEnd

Function LaunchReqora
  !if "${MODE}" != "web"
    ${If} ${SectionIsSelected} ${Desktop}
      Exec '"$INSTDIR\desktop\reqora.exe"'
      Return
    ${EndIf}
  !endif
  !if "${MODE}" != "desktop"
    Exec '"$INSTDIR\web\runtime\node.exe" "$INSTDIR\web\cli.mjs" open'
  !endif
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  IfFileExists "$INSTDIR\.reqora-install" 0 invalid
  FileOpen $0 "$INSTDIR\.reqora-install" r
  FileRead $0 $1
  FileClose $0
  StrCmp $1 "reqora-install-v1" 0 invalid
  nsExec::ExecToLog '"$INSTDIR\web\runtime\node.exe" "$INSTDIR\web\cli.mjs" stop'
  Pop $0
  ClearErrors
  IfFileExists "$INSTDIR\desktop\*.*" 0 +2
    RMDir /r "$INSTDIR\desktop"
  IfFileExists "$INSTDIR\web\*.*" 0 +2
    RMDir /r "$INSTDIR\web"
  IfErrors 0 removed
    MessageBox MB_ICONSTOP "Close all Reqora windows and run uninstall again."
    Abort
  removed:
  Delete "$SMPROGRAMS\Reqora\Reqora Desktop.lnk"
  Delete "$SMPROGRAMS\Reqora\Reqora Web.lnk"
  Delete "$SMPROGRAMS\Reqora\Stop Reqora Web.lnk"
  Delete "$SMPROGRAMS\Reqora\Uninstall Reqora.lnk"
  RMDir "$SMPROGRAMS\Reqora"
  DeleteRegKey HKCU "Software\Reqora"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Reqora"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\NOTICE.txt"
  Delete "$INSTDIR\reqora.ico"
  Delete "$INSTDIR\reqora-run.cmd"
  Delete "$INSTDIR\.reqora-install"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Goto done
  invalid:
    MessageBox MB_ICONSTOP "This is not a managed Reqora installation."
    Abort
  done:
SectionEnd
