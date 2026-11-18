# ChatServer

Локальный Twitch-чат для OBS. Приложение сидит в трее, отдает виджет, в OBS вставляется ссылка из окна.

Логин канала не зашит. Его вводишь в окне приложения.

## Запуск

```bash
npm install
npm start
```

## Сборки

С мака собираются обе. Готовые файлы падают в `dist/` и в гит не коммитятся.

```bash
npm run build:mac
npm run build:win
```

- Mac: `dist/ChatServer-<version>-arm64.dmg`
- Windows x64: `dist/ChatServer-<version>-x64.exe`

Приложение не подписано. macOS при первом запуске может ругаться: ПКМ по приложению → Открыть.

## Выкладка на GitHub

Репозиторий на GitHub создаешь пустым, без README, без .gitignore и без лицензии. Иначе первый пуш разъедется с локальной историей.

```bash
cd ChatServer
git remote add origin git@github.com:<юзер>/ChatServer.git
git push -u origin main
```

## Релиз

Версия файла берется из `version` в `package.json`, не из тега. Перед релизом подними версию и закоммить.

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions соберет dmg и exe и прикрепит их к релизу этого тега.

Ручной релиз, если Actions не нужен. Сначала локальная сборка, потом:

```bash
gh release create v1.0.0 dist/ChatServer-1.0.0-arm64.dmg dist/ChatServer-1.0.0-x64.exe
```
