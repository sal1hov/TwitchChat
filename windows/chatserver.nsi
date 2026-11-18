Unicode true
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "1.0.1"
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

Section "Uninstall"
  Delete "$SMPROGRAMS\ChatServer.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChatServer"
SectionEnd
