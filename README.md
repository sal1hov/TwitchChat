# ChatServer

Локальный Twitch-чат для OBS. Приложение сидит в трее, отдает виджет, в OBS вставляется ссылка из окна.

Логин канала не зашит. Его вводишь в окне приложения.

## Запуск

```bash
npm install
npm start
```

## Сборки

Готовые файлы падают в `dist/` и в гит не коммитятся. Внутри установщика уже всё, пользователю ничего отдельно ставить не надо.

```bash
npm run build:mac
npm run build:win
```

- Mac, образ: `dist/ChatServer-<version>-arm64.dmg`
- Mac, установщик: `dist/ChatServer-<version>-arm64.pkg`
- Windows, установщик: `dist/ChatServer-<version>-x64-setup.exe`

Windows-приложение на .NET, собирается отдельно от Mac. Для установщика нужен NSIS: `brew install makensis`.

Приложение не подписано. macOS при первом запуске может ругаться: ПКМ по приложению → Открыть.

## Выкладка на GitHub

Репозиторий на GitHub создаешь пустым, без README, без .gitignore и без лицензии. Иначе первый пуш разъедется с локальной историей.

```bash
cd ChatServer
git remote add origin git@github.com:<юзер>/ChatServer.git
git push -u origin main
```

## Релиз

Сборки делаешь сам и кладёшь файлы в релиз. Actions нет.

Подними `version` в `package.json`, закоммить, собери:

```bash
npm run build
```

Дальше на GitHub: Releases → Draft a new release. Тег `v1.0.0`, к нему прикрепи:

- `dist/ChatServer-1.0.0-arm64.dmg`
- `dist/ChatServer-1.0.0-arm64.pkg`
- `dist/ChatServer-1.0.0-x64-setup.exe`

То же через CLI:

```bash
gh release create v1.0.0 dist/ChatServer-1.0.0-arm64.dmg dist/ChatServer-1.0.0-arm64.pkg dist/ChatServer-1.0.0-x64-setup.exe --title v1.0.0
```
