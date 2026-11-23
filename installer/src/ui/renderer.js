
const $ = id => document.getElementById(id);

let info;
let selectedPath = '';
let installing = false;
let lastError = '';

const screens = [
  'welcome',
  'location',
  'progress',
  'complete',
  'error'
];

function show(name) {
  for (const id of screens) {
    $(id).classList.toggle('hidden', id !== name);
  }
}

function stageName(stage) {
  return ({
    copy: 'Копирование файлов',
    webview: 'Компоненты Windows',
    shortcuts: 'Завершение настройки',
    prepare: 'Подготовка',
    finish: 'Завершение',
    done: 'Готово'
  })[stage] || 'Установка';
}

function showError(error) {
  lastError = String(
    error?.stack || error?.message || error || 'Неизвестная ошибка'
  );

  $('errorMessage').textContent = lastError;
  $('errorDetails').classList.add('hidden');
  $('showError').classList.remove('hidden');
  $('showError').innerHTML = 'Показать ошибку <span>⌄</span>';

  show('error');
}

(async () => {
  try {
    info = await window.setupAPI.info();

    selectedPath = info.defaultPath;

    $('installPath').value = selectedPath;
    $('version').textContent = `Версия ${info.version}`;

    $('continue').addEventListener('click', () => show('location'));
    $('back').addEventListener('click', () => show('welcome'));

    $('minimize').addEventListener('click', () => {
      window.setupAPI.minimize();
    });

    $('close').addEventListener('click', () => {
      window.setupAPI.close();
    });

    $('errorClose').addEventListener('click', () => {
      window.setupAPI.close();
    });

    $('browse').addEventListener('click', async () => {
      try {
        const folder = await window.setupAPI.chooseFolder(
          $('installPath').value
        );

        if (folder) {
          $('installPath').value = folder;
        }
      } catch (error) {
        showError(error);
      }
    });

    $('install').addEventListener('click', runInstall);
    $('retry').addEventListener('click', runInstall);

    $('launch').addEventListener('click', async () => {
      try {
        await window.setupAPI.launch(selectedPath);
      } catch (error) {
        showError(error);
      }
    });

    $('openFolder').addEventListener('click', async () => {
      try {
        await window.setupAPI.openFolder(selectedPath);
      } catch (error) {
        showError(error);
      }
    });

    $('showError').addEventListener('click', () => {
      const details = $('errorDetails');
      const isHidden = details.classList.contains('hidden');

      details.classList.toggle('hidden', !isHidden);

      $('showError').innerHTML = isHidden
        ? 'Скрыть ошибку <span>⌃</span>'
        : 'Показать ошибку <span>⌄</span>';
    });

    $('copyError').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(lastError);

        $('copyError').textContent = 'Скопировано ✓';

        setTimeout(() => {
          $('copyError').textContent = 'Копировать';
        }, 1800);
      } catch {
        const range = document.createRange();
        range.selectNodeContents($('errorMessage'));

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        $('copyError').textContent = 'Выделено';
      }
    });

    window.setupAPI.onProgress(data => {
      $('progressBar').style.width = `${data.percent}%`;
      $('progressPercent').textContent = `${data.percent}%`;
      $('progressStage').textContent = stageName(data.stage);
      $('progressMessage').textContent = data.message;
      $('progressDetail').textContent = data.message;
    });
  } catch (error) {
    showError(error);
  }
})();

async function runInstall() {
  if (installing) return;

  selectedPath = $('installPath').value.trim();

  if (!selectedPath) {
    showError('Не выбрана папка для установки.');
    return;
  }

  installing = true;

  $('install').disabled = true;
  $('retry').disabled = true;

  $('progressBar').style.width = '0%';
  $('progressPercent').textContent = '0%';
  $('progressStage').textContent = 'Подготовка';
  $('progressMessage').textContent = 'Подготавливаем файлы приложения…';
  $('progressDetail').textContent = 'Инициализация установщика';

  show('progress');

  try {
    const result = await window.setupAPI.install(selectedPath);

    if (!result || !result.ok) {
      throw new Error(result?.error || 'Установка завершилась с неизвестной ошибкой.');
    }

    $('installedPath').textContent = selectedPath;
    show('complete');
  } catch (error) {
    showError(error);
  } finally {
    installing = false;

    $('install').disabled = false;
    $('retry').disabled = false;
  }
}
