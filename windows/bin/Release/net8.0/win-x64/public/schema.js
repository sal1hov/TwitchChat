/* Описание всех настроек оформления.
   По нему окно настроек само рисует элементы управления, а виджет берёт значения по умолчанию.
   Все значения хранятся строками: цвета '#rrggbb', переключатели '1' или '0'.
   Чтобы добавить настройку, допиши поле сюда и используй его в chat.js. */
(() => {
  const fonts = [
    'Arial', 'Segoe UI', 'Verdana', 'Tahoma', 'Trebuchet MS',
    'Georgia', 'Impact', 'Comic Sans MS', 'Consolas'
  ];

  window.CHAT_SCHEMA = {
    tabs: [
      {
        id: 'look',
        title: 'Вид',
        fields: [
          { key: 'bg', type: 'color', label: 'Цвет фона чата', def: '#000000' },
          { key: 'op', type: 'range', label: 'Непрозрачность фона', def: '65', min: 0, max: 100, unit: '%' },
          { key: 'bw', type: 'range', label: 'Толщина рамки', def: '0', min: 0, max: 12, unit: 'px', zero: 'нет' },
          { key: 'bc', type: 'color', label: 'Цвет рамки', def: '#9146ff' },
          { key: 'br', type: 'range', label: 'Скругление углов чата', def: '0', min: 0, max: 60, unit: 'px' },
          { key: 'font', type: 'select', label: 'Шрифт', def: 'Arial', options: fonts.map((f) => [f, f]),
            hint: 'Шрифт должен быть установлен на компьютере, где запущен OBS.' },
          { key: 'size', type: 'range', label: 'Размер текста', def: '41', min: 20, max: 80, unit: 'px' },
          { key: 'color', type: 'color', label: 'Цвет текста', def: '#ffffff' },
          { key: 'outline', type: 'bool', label: 'Чёрная обводка текста', def: '1' },
          { key: 'dir', type: 'select', label: 'Куда добавляются сообщения', def: 'bottom',
            options: [['bottom', 'Новые снизу'], ['top', 'Новые сверху']] },
          { key: 'align', type: 'select', label: 'Выравнивание сообщений', def: 'left',
            options: [['left', 'По левому краю'], ['right', 'По правому краю']] },
          { key: 'anim', type: 'bool', label: 'Плавное появление сообщений', def: '0' },
          { key: 'fade', type: 'range', label: 'Сообщения исчезают через', def: '0', min: 0, max: 300, unit: 'с', zero: 'не исчезают' }
        ]
      },
      {
        id: 'messages',
        title: 'Сообщения',
        fields: [
          { key: 'msgbg', type: 'color', label: 'Цвет подложки сообщения', def: '#000000' },
          { key: 'msgop', type: 'range', label: 'Непрозрачность подложки', def: '0', min: 0, max: 100, unit: '%', zero: 'нет' },
          { key: 'msgr', type: 'range', label: 'Скругление подложки', def: '0', min: 0, max: 40, unit: 'px' },
          { key: 'pad', type: 'range', label: 'Отступ внутри сообщения', def: '0', min: 0, max: 30, unit: 'px' },
          { key: 'gap', type: 'range', label: 'Расстояние между сообщениями', def: '8', min: 0, max: 40, unit: 'px' },
          { key: 'nickbold', type: 'bool', label: 'Жирный ник', def: '1' },
          { key: 'badges', type: 'bool', label: 'Показывать бейджи', def: '1' },
          { key: 'nick', type: 'bool', label: 'Показывать ники', def: '1' },
          { key: 'time', type: 'bool', label: 'Показывать время', def: '1' },
          { key: 'reply', type: 'bool', label: 'Показывать ответы', def: '1' },
          { key: 'flags', type: 'bool', label: 'Метки «первый», «хайлайт», «рейд»', def: '1' },
          { key: 'sys', type: 'bool', label: 'Системные строки (подключение, ошибки)', def: '1' },
          { key: 'maxlen', type: 'range', label: 'Обрезать длинные сообщения', def: '0', min: 0, max: 500, step: 10, unit: 'симв.', zero: 'не обрезать' },
          { key: 'max', type: 'number', label: 'Сколько сообщений держать на экране', def: '', min: 1, max: 200,
            placeholder: 'по умолчанию из config.json' }
        ]
      },
      {
        id: 'filters',
        title: 'Фильтры',
        fields: [
          { key: 'hidebots', type: 'text', label: 'Скрывать сообщения от ников', def: '',
            placeholder: 'nightbot, streamelements',
            hint: 'Ники через запятую. В предпросмотре есть сообщение от Nightbot.' },
          { key: 'hidecmd', type: 'bool', label: 'Скрывать команды (начинаются с !)', def: '0' },
          { key: 'hidewords', type: 'text', label: 'Скрывать сообщения со словами', def: '',
            placeholder: 'слово, другое слово', hint: 'Слова через запятую, регистр не важен.' }
        ]
      },
      {
        id: 'highlight',
        title: 'Подсветка',
        fields: [
          { key: 'hl_on', type: 'bool', label: 'Включить подсветку сообщений', def: '0' },
          { key: 'hl_color', type: 'color', label: 'Цвет подсветки', def: '#9146ff' },
          { key: 'hl_op', type: 'range', label: 'Яркость подсветки', def: '35', min: 0, max: 100, unit: '%' },
          { key: 'hl_mod', type: 'bool', label: 'Модераторы', def: '1' },
          { key: 'hl_vip', type: 'bool', label: 'VIP', def: '0' },
          { key: 'hl_sub', type: 'bool', label: 'Подписчики', def: '0' },
          { key: 'hl_first', type: 'bool', label: 'Первые сообщения', def: '1' },
          { key: 'hl_users', type: 'text', label: 'Ники', def: '', placeholder: 'nick1, nick2',
            hint: 'Ники через запятую.' },
          { key: 'hl_words', type: 'text', label: 'Слова в сообщении', def: '', placeholder: 'слово, другое слово',
            hint: 'Подсветка действует и на уже показанные сообщения.' }
        ]
      },
      {
        id: 'emotes',
        title: 'Смайлы',
        fields: [
          { key: 'em_twitch', type: 'bool', label: 'Смайлы Twitch', def: '1' },
          { key: 'em_bttv', type: 'bool', label: 'BetterTTV', def: '1' },
          { key: 'em_7tv', type: 'bool', label: '7TV', def: '1' },
          { key: 'em_ffz', type: 'bool', label: 'FrankerFaceZ', def: '1' },
          { key: 'emsize', type: 'range', label: 'Размер смайлов', def: '100', min: 50, max: 250, unit: '%',
            hint: 'Выключенные смайлы показываются текстом, как их пишут в чате.' }
        ]
      }
    ]
  };
})();