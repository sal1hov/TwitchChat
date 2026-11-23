# TwitchChat Setup

Фирменный установщик TwitchChat с отдельным Electron-интерфейсом в тёмной glass-стилистике приложения.

## Windows

Из корня проекта:

```powershell
npm run build:win
```

Команда:
1. Публикует Avalonia-приложение в `dist/win-publish`.
2. Добавляет встроенный Node.js и production-зависимости.
3. Подготавливает WebView2 Standalone Installer.
4. Собирает payload и упаковывает фирменный Electron Setup.

Готовый файл:

```text
dist/installer/TwitchChat-Setup-0.1.0-win-x64.exe
```

При первом запуске сборки автоматически устанавливаются зависимости `installer`. В дальнейшем они используются из `installer/node_modules`.

Старый NSIS-установщик оставлен как резервный вариант:

```powershell
npm run build:win:nsis
```

## macOS

Сначала собери основное приложение в `.app`:

```bash
npx electron-builder --mac --dir
```

Затем установи зависимости установщика и собери DMG:

```bash
cd installer
npm install
npm run build
```

Результат находится в `dist/installer/`.

Для распространения macOS-приложения вне локального тестирования отдельно настрой Apple Developer signing и notarization.
