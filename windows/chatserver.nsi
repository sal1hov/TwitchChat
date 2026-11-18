Unicode true
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "2.0.0"
!endif
!ifndef PUBLISHDIR
  !error "PUBLISHDIR is not set"
!endif
!ifndef OUTFILE
  !error "OUTFILE is not set"
!endif

Name "ChatServer"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\ChatServer"
RequestExecutionLevel user
SetCompressor lzma

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Создать ярлык на рабочем столе"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"

Section
  SetOutPath "$INSTDIR"
  File /r "${PUBLISHDIR}/*.*"
  CreateShortcut "$SMPROGRAMS\ChatServer.lnk" "$INSTDIR\ChatServer.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChatServer" "DisplayName" "ChatServer"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChatServer" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChatServer" "DisplayVersion" "${VERSION}"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChatServer" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChatServer" "NoRepair" 1
SectionEnd

Function CreateDesktopShortcut
  CreateShortcut "$DESKTOP\ChatServer.lnk" "$INSTDIR\ChatServer.exe"
FunctionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\ChatServer.lnk"
  Delete "$DESKTOP\ChatServer.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChatServer"
SectionEnd
