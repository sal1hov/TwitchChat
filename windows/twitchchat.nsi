
Unicode true
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "0.1.1"
!endif

!ifndef PUBLISHDIR
  !error "PUBLISHDIR is not set"
!endif

!ifndef OUTFILE
  !error "OUTFILE is not set"
!endif

Name "TwitchChat"
Caption "Установка TwitchChat"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\TwitchChat"
InstallDirRegKey HKCU "Software\TwitchChat" "InstallDir"

RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\TwitchChat.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить TwitchChat"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Russian"


; Контекст текущего пользователя.
Function .onInit
  SetShellVarContext current
  SetRegView 64
FunctionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
FunctionEnd


; Проверка WebView2 Runtime.
; Проверяем HKLM и HKCU в 32- и 64-битном представлениях.
; Возвращаем 1, если Runtime найден, иначе 0.

Function CheckWebView2

  ; 32-bit HKLM
  SetRegView 32

  ClearErrors
  ReadRegStr $1 HKLM \
    "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" \
    "pv"

  StrCmp $1 "" check_hkcu_32
  StrCmp $1 "0.0.0.0" check_hkcu_32
  Goto webview2_found

check_hkcu_32:

  ; 32-bit HKCU
  ClearErrors
  ReadRegStr $1 HKCU \
    "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" \
    "pv"

  StrCmp $1 "" check_hklm_64
  StrCmp $1 "0.0.0.0" check_hklm_64
  Goto webview2_found

check_hklm_64:

  ; 64-bit HKLM
  SetRegView 64

  ClearErrors
  ReadRegStr $1 HKLM \
    "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" \
    "pv"

  StrCmp $1 "" check_hkcu_64
  StrCmp $1 "0.0.0.0" check_hkcu_64
  Goto webview2_found

check_hkcu_64:

  ; 64-bit HKCU
  ClearErrors
  ReadRegStr $1 HKCU \
    "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" \
    "pv"

  StrCmp $1 "" webview2_missing
  StrCmp $1 "0.0.0.0" webview2_missing
  Goto webview2_found

webview2_found:

  SetRegView 64
  Push "1"
  Return

webview2_missing:

  SetRegView 64
  Push "0"

FunctionEnd


Section "Install"

  SetShellVarContext current
  SetRegView 64

  SetOutPath "$INSTDIR"

  ; Копируем файлы приложения, но не автономный установщик WebView2.
  File /r /x "MicrosoftEdgeWebView2RuntimeInstallerX64.exe" "${PUBLISHDIR}\*"

  ; Проверяем наличие WebView2.
  Call CheckWebView2
  Pop $1

  StrCmp $1 "1" webview2_done

  ; Runtime отсутствует.
  ; Извлекаем установщик во временную папку.
  DetailPrint "WebView2 Runtime не найден. Установка..."

  SetOutPath "$PLUGINSDIR"

  File /oname=MicrosoftEdgeWebView2RuntimeInstallerX64.exe \
    "${PUBLISHDIR}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"

  ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" /silent /install' $0

  ; 0 — успешно.
  ; 3010 — успешно, необходима перезагрузка.
  StrCmp $0 "0" webview2_verify
  StrCmp $0 "3010" webview2_verify

  MessageBox MB_ICONSTOP|MB_OK \
    "Не удалось установить Microsoft Edge WebView2 Runtime.$\r$\nКод ошибки: $0"

  Abort

webview2_verify:

  ; Повторная проверка после установки.
  Call CheckWebView2
  Pop $1

  StrCmp $1 "1" webview2_done

  MessageBox MB_ICONSTOP|MB_OK \
    "Установщик WebView2 завершился, но Runtime не обнаружен.$\r$\nПерезагрузите компьютер и повторите установку."

  Abort

webview2_done:

  SetRegView 64
  SetOutPath "$INSTDIR"

  ; Создаём деинсталлятор.
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Ярлыки меню Пуск.
  CreateDirectory "$SMPROGRAMS\TwitchChat"

  CreateShortcut \
    "$SMPROGRAMS\TwitchChat\TwitchChat.lnk" \
    "$INSTDIR\TwitchChat.exe"

  CreateShortcut \
    "$SMPROGRAMS\TwitchChat\Удалить TwitchChat.lnk" \
    "$INSTDIR\Uninstall.exe"

  ; Ярлык рабочего стола.
  CreateShortcut \
    "$DESKTOP\TwitchChat.lnk" \
    "$INSTDIR\TwitchChat.exe"

  ; Сохраняем путь установки.
  WriteRegStr HKCU \
    "Software\TwitchChat" \
    "InstallDir" "$INSTDIR"

  ; Регистрация приложения в Windows.
  WriteRegStr HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\TwitchChat" \
    "DisplayName" "TwitchChat"

  WriteRegStr HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\TwitchChat" \
    "DisplayVersion" "${VERSION}"

  WriteRegStr HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\TwitchChat" \
    "Publisher" "TwitchChat"

  WriteRegStr HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\TwitchChat" \
    "InstallLocation" "$INSTDIR"

  WriteRegStr HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\TwitchChat" \
    "DisplayIcon" "$INSTDIR\TwitchChat.exe"

  ; Корректные кавычки для Windows.
  WriteRegStr HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\TwitchChat" \
    "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""

  WriteRegStr HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\TwitchChat" \
    "QuietUninstallString" "$\"$INSTDIR\Uninstall.exe$\" /S"

  WriteRegDWORD HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\TwitchChat" \
    "NoModify" 1

  WriteRegDWORD HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\TwitchChat" \
    "NoRepair" 1

  ; Размер приложения в байтах (примерная оценка).
  WriteRegDWORD HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\TwitchChat" \
    "EstimatedSize" 100000

SectionEnd


Section "Uninstall"

  SetShellVarContext current
  SetRegView 64

  ; Ярлыки.
  Delete "$SMPROGRAMS\TwitchChat\TwitchChat.lnk"
  Delete "$SMPROGRAMS\TwitchChat\Удалить TwitchChat.lnk"
  RMDir "$SMPROGRAMS\TwitchChat"

  Delete "$DESKTOP\TwitchChat.lnk"

  ; Записи реестра.
  DeleteRegKey HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\TwitchChat"

  DeleteRegKey HKCU "Software\TwitchChat"

  ; Удаляем возможную старую запись из 32-битного представления.
  SetRegView 32

  DeleteRegKey HKCU \
    "Software\Microsoft\Windows\CurrentVersion\Uninstall\TwitchChat"

  ; Удаление файлов приложения.
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR"

SectionEnd
