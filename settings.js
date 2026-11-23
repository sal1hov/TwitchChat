(() => {
  if (!window.api || !window.CHAT_SCHEMA) return;

  const SCHEMA = window.CHAT_SCHEMA;
  const FIELDS = SCHEMA.tabs.flatMap((tab) => tab.fields);
  const DEFAULTS = Object.fromEntries(FIELDS.map((f) => [f.key, f.def]));
  const PREVIEW_WIDTH = 700; // ширина «экрана» внутри предпросмотра

  const esc = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');

  function fieldHtml(f) {
    const id = 'st-' + f.key;
    const hint = f.hint ? '<small>' + esc(f.hint) + '</small>' : '';
    const label = '<label for="' + id + '">' + esc(f.label) + '</label>';

    switch (f.type) {
      case 'color':
        return '<div class="st-field st-inline">' + label + '<input type="color" id="' + id + '"></div>';
      case 'range':
        return '<div class="st-field">' + label + '<div class="st-row">' +
          '<input type="range" id="' + id + '" min="' + f.min + '" max="' + f.max + '" step="' + (f.step || 1) + '">' +
          '<output id="' + id + '-out"></output></div>' + hint + '</div>';
      case 'select':
        return '<div class="st-field">' + label + '<select id="' + id + '">' +
          f.options.map((o) => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('') +
          '</select>' + hint + '</div>';
      case 'bool':
        return '<label class="st-check"><input type="checkbox" id="' + id + '"> ' + esc(f.label) + '</label>';
      case 'number':
        return '<div class="st-field">' + label + '<input type="number" id="' + id + '" min="' + f.min +
          '" max="' + f.max + '" placeholder="' + esc(f.placeholder || '') + '">' + hint + '</div>';
      default:
        return '<div class="st-field">' + label + '<input type="text" id="' + id + '" placeholder="' +
          esc(f.placeholder || '') + '" autocomplete="off" spellcheck="false">' + hint + '</div>';
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'st-overlay';
  overlay.innerHTML =
    '<div class="st-head">' +
      '<button type="button" class="st-back" id="st-back">' +
        '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>' +
        'Назад</button>' +
      '<h1>Настройки чата</h1>' +
    '</div>' +
    '<div class="st-tabs">' +
      SCHEMA.tabs.map((t) => '<button type="button" class="st-tab" data-tab="' + t.id + '">' + esc(t.title) + '</button>').join('') +
    '</div>' +
    '<div class="st-main">' +
      '<div class="st-controls">' +
        '<div class="st-scroll">' +
          SCHEMA.tabs.map((t) => '<div class="st-panel" data-panel="' + t.id + '">' + t.fields.map(fieldHtml).join('') + '</div>').join('') +
        '</div>' +
        '<div class="st-actions">' +
          '<button type="button" class="st-reset" id="st-reset">Сбросить вкладку</button>' +
          '<span class="st-state" id="st-state"></span>' +
          '<button type="button" class="st-save" id="st-save" disabled>Сохранить</button>' +
        '</div>' +
      '</div>' +
      '<div class="st-preview" id="st-preview">' +
        '<iframe id="st-frame" src="public/index.html?demo=1" title="Предпросмотр чата"></iframe>' +
      '</div>' +
    '</div>' +
    '<div class="st-confirm" id="st-confirm">' +
      '<div class="st-dialog">' +
        '<p>Сохранить изменения?</p>' +
        '<div class="st-dialog-btns">' +
          '<button type="button" id="st-c-save">Сохранить</button>' +
          '<button type="button" id="st-c-drop">Не сохранять</button>' +
          '<button type="button" id="st-c-cancel">Отмена</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  const $ = (id) => document.getElementById(id);
  const frame = $('st-frame');
  const preview = $('st-preview');

  /* ---------- Чтение и запись значений формы ---------- */

  function normColor(value, fallback) {
    const v = String(value || '').replace('#', '');
    return '#' + (/^[0-9a-f]{6}$/i.test(v) ? v : String(fallback).replace('#', ''));
  }

  function writeField(f, raw) {
    const el = $('st-' + f.key);
    const value = raw === undefined || raw === null ? f.def : String(raw);
    if (f.type === 'color') el.value = normColor(value, f.def);
    else if (f.type === 'bool') el.checked = value === '1';
    else if (f.type === 'select') el.value = f.options.some((o) => o[0] === value) ? value : f.def;
    else if (f.type === 'range') el.value = Number.isFinite(Number(value)) ? value : f.def;
    else el.value = value;
  }

  function readField(f) {
    const el = $('st-' + f.key);
    if (f.type === 'bool') return el.checked ? '1' : '0';
    if (f.type === 'text' || f.type === 'number') return el.value.trim();
    return String(el.value);
  }

  function read() {
    const values = {};
    for (const f of FIELDS) values[f.key] = readField(f);
    return values;
  }

  function write(values) {
    for (const f of FIELDS) writeField(f, values ? values[f.key] : undefined);
    updateOutputs();
  }

  function updateOutputs() {
    for (const f of FIELDS) {
      if (f.type !== 'range') continue;
      const el = $('st-' + f.key);
      const value = Number(el.value);
      $('st-' + f.key + '-out').textContent =
        value === 0 && f.zero ? f.zero : value + (f.unit ? ' ' + f.unit : '');
      el.style.setProperty('--p', ((value - f.min) / (f.max - f.min)) * 100 + '%');
    }
  }

  /* ---------- Предпросмотр ---------- */

  function fit() {
    const scale = preview.clientWidth / PREVIEW_WIDTH;
    if (!scale) return;
    frame.style.width = PREVIEW_WIDTH + 'px';
    frame.style.height = Math.round(preview.clientHeight / scale) + 'px';
    frame.style.transform = 'scale(' + scale + ')';
  }

  function sendToPreview(values) {
    if (frame.contentWindow) {
      frame.contentWindow.postMessage({ type: 'settings', params: values }, '*');
    }
  }

  new ResizeObserver(fit).observe(preview);
  frame.addEventListener('load', () => {
    fit();
    sendToPreview(read());
  });

  /* ---------- Сохранение ---------- */

  // Последние сохранённые значения. В OBS и в файл попадает только то, что сохранено кнопкой.
  let saved = { ...DEFAULTS };
  let flashTimer = null;

  function isDirty() {
    const now = read();
    return FIELDS.some((f) => String(now[f.key]) !== String(saved[f.key]));
  }

  function refreshState() {
    const dirty = isDirty();
    $('st-save').disabled = !dirty;
    $('st-state').textContent = dirty ? 'Есть несохранённые изменения' : '';
  }

  function update() {
    updateOutputs();
    sendToPreview(read());
    clearTimeout(flashTimer);
    refreshState();
  }

  async function save() {
    const values = read();
    const saveButton = $('st-save');
    saveButton.disabled = true;
    $('st-state').textContent = 'Сохраняю…';
    try {
      const result = await window.api.setAppearance(values);
      saved = { ...values, ...(result || {}) };
      window.dispatchEvent(new CustomEvent('appearance-saved', { detail: saved }));
      $('st-state').textContent = 'Сохранено ✓';
      clearTimeout(flashTimer);
      flashTimer = setTimeout(refreshState, 1500);
      return true;
    } catch (error) {
      $('st-state').textContent = 'Не удалось сохранить: ' + (error?.message || error || 'ошибка');
      refreshState();
      return false;
    }
  }

  overlay.addEventListener('input', update);
  $('st-save').addEventListener('click', save);

  /* ---------- Вкладки ---------- */

  let currentTab = SCHEMA.tabs[0].id;

  function showTab(id) {
    currentTab = id;
    overlay.querySelectorAll('.st-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    overlay.querySelectorAll('.st-panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === id));
    overlay.querySelector('.st-scroll').scrollTop = 0;
  }

  overlay.querySelectorAll('.st-tab').forEach((b) => {
    b.addEventListener('click', () => showTab(b.dataset.tab));
  });

  $('st-reset').addEventListener('click', () => {
    const tab = SCHEMA.tabs.find((t) => t.id === currentTab);
    for (const f of tab.fields) writeField(f, f.def);
    update();
  });

  /* ---------- Открытие и возврат в главное меню ---------- */

  const confirmBox = $('st-confirm');

  function openSettings() {
    overlay.classList.add('show');
    fit();
    sendToPreview(read());
  }

  function leave() {
    confirmBox.classList.remove('show');
    overlay.classList.remove('show');
  }

  // «Назад»: если есть несохранённые изменения, спрашиваем, что с ними делать
  function requestLeave() {
    if (isDirty()) confirmBox.classList.add('show');
    else leave();
  }

  $('settings-open').addEventListener('click', openSettings);
  $('st-back').addEventListener('click', requestLeave);

  $('st-c-save').addEventListener('click', async () => {
    if (await save()) leave();
  });

  $('st-c-drop').addEventListener('click', () => {
    write(saved); // возвращаем форму и предпросмотр к сохранённому
    update();
    leave();
  });

  $('st-c-cancel').addEventListener('click', () => confirmBox.classList.remove('show'));

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !overlay.classList.contains('show')) return;
    if (confirmBox.classList.contains('show')) confirmBox.classList.remove('show');
    else requestLeave();
  });

  /* ---------- Старт ---------- */

  showTab(currentTab);
  write(DEFAULTS);
  saved = read();
  window.api.getAppearance().then((stored) => {
    write(stored || {});
    saved = read();
    refreshState();
    sendToPreview(saved);
  }).catch((error) => {
    $('st-state').textContent = 'Не удалось загрузить настройки: ' + (error?.message || error || 'ошибка');
    refreshState();
  });
})();