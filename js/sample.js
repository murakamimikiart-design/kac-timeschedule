// ===== サンプルデータ =====
// 設営ベースのサンプル：データ無し（空のひな形）。行はセクション名のみ
window.KAC_SAMPLE = {
  version: 1, base: 'setup',
  meta: { program: '', title: '', dates: '', venue: '', updated: '' },
  settings: { startHour: 9, endHour: 23, slot: 30, openTime: '09:30', closeTime: '22:00' },
  lanes: ['舞台', '照明', '音響', '出演者', '制作', 'KAC'].map(n => ({ id: Math.random().toString(36).slice(2, 9), name: n })),
  days: [], notes: '',
  form: { technical: [], personnel: [], type: 'stage', events: [], techActions: [] }
};

// 入力フォームのサンプル（設営用）：役職のみの汎用データ。1日分の流れ（仕込み→リハ→本番→退館）
window.KAC_FORM_SAMPLE = (function () {
  const T = ['舞台', '照明', '音響'];
  const ph = (type, label, startTime, endTime, technical = [], personnel = []) => ({ type, label, startTime, endTime, technical, personnel });
  return {
    technical: T, type: 'stage',
    personnel: ['出演者', '制作', 'KAC'],
    techActions: [],
    events: [
      { date: '2026-10-01', name: '', type: 'stage', location: '', label: '仕込み', phases: [
        ph('setup', '朝MT', '09:30', '10:00'),
        ph('setup', 'システムチェック', '10:00', '12:00', T),
        ph('break', '昼休憩', '12:00', '13:00'),
        ph('setup', 'リハ準備', '13:00', '14:00'),
        ph('performance', 'リハーサル', '14:00', '17:00'),
        ph('break', '休憩', '17:00', '18:00'),
        ph('setup', 'プリセット', '18:00', '19:30', ['舞台', '照明']),
        ph('setup', '本番準備', '18:00', '19:30', [], ['制作', 'KAC']),
        ph('performance', 'GP', '19:30', '20:30'),
        ph('teardown', 'FB〜退館', '20:30', '22:00')
      ] },
      { date: '2026-10-02', name: '', type: 'stage', location: '', label: '本番', phases: [
        ph('setup', 'プリセット', '17:30', '19:30', ['舞台', '照明']),
        ph('setup', '本番準備', '17:30', '19:30', [], ['制作', 'KAC']),
        ph('performance', '本番', '20:00', '21:00'),
        ph('teardown', 'バラシ〜退館', '21:00', '22:00')
      ] }
    ]
  };
})();

// 運営ベースのサンプル（2026-09-14 ユーザー編集版）
// 行＝事業（イベント）。lanes / days は入力フォームから自動生成される
window.KAC_OPS_SAMPLE = {
  version: 1, base: 'ops',
  meta: { program: '', title: '9月イベント タイムスケジュール', dates: '2026年9月12日(土)', venue: '京都芸術センター', updated: '2026-09-14' },
  settings: { startHour: 9, endHour: 23, slot: 30, openTime: '', closeTime: '' },
  lanes: [], days: [], notes: '',
  form: {
    technical: ['鬣', '川瀬', '十河', '村上'],
    personnel: ['原田', '押尾', '青田', '雪岡', '萩原'],
    type: 'stage',
    events: [
      { date: '2026-09-12', name: '明倫レコード倶楽部', type: 'stage', location: 'フリースペース',
        phases: [
          { type: 'setup', label: '午前中設営', startTime: '10:00', endTime: '12:30', technical: ['鬣', '十河', '川瀬', '村上'], personnel: ['原田', '押尾'] },
          { type: 'performance', label: '本番', startTime: '15:00', endTime: '18:00', technical: [], personnel: ['原田', '押尾'] },
          { type: 'teardown', label: '', startTime: '18:00', endTime: '20:00', technical: ['鬣', '川瀬', '十河', '村上'], personnel: ['原田', '押尾'] }
        ] },
      { date: '2026-09-12', name: 'UAC', type: 'talk', location: '講堂',
        phases: [
          { type: 'setup', label: '準備', startTime: '12:00', endTime: '22:00', technical: ['鬣', '川瀬', '十河', '村上'], personnel: [] }
        ] },
      { date: '2026-09-12', name: 'TARO', type: 'workshop', location: '北ギャラリー',
        phases: [
          { type: 'performance', label: '開催', startTime: '10:00', endTime: '17:00', technical: [], personnel: ['萩原'] },
          { type: 'teardown', label: '', startTime: '17:00', endTime: '19:00', technical: ['鬣', '川瀬', '十河', '村上'], personnel: [] }
        ] }
    ],
    techActions: [
      { date: '2026-09-12', type: 'mt', label: '', startTime: '09:30', endTime: '10:00', technical: ['鬣', '川瀬', '十河', '村上'] },
      { date: '2026-09-12', type: 'break', label: '', startTime: '13:00', endTime: '14:00', technical: [] }
    ]
  }
};
