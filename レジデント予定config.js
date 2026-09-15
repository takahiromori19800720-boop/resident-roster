// ============================================================
//  レジデント勤務表 — 設定ファイル
// ============================================================
//  Firebase と Google OAuth は 休日当番 Roster (duty-roster) と同じ
//  プロジェクトを共用します。Firestore のコレクション名は rr_ で
//  始まるので、既存アプリのデータとは混ざりません。
// ============================================================

window.APP_CONFIG = {

  // ─── Firebase の設定（duty-roster と共通） ─────────────
  firebase: {
    apiKey:            "AIzaSyBkX-QXRBcjGheIBiAPMn5iY3k_92yFGD4",
    authDomain:        "duty-roster-nmc.firebaseapp.com",
    projectId:         "duty-roster-nmc",
    storageBucket:     "duty-roster-nmc.firebasestorage.app",
    messagingSenderId: "193049272380",
    appId:             "1:193049272380:web:bbec3e1c0accce91d3e339",
  },

  // ─── Google OAuth + Calendar API（duty-roster と共通） ──
  //   calendarId を別のカレンダーにしたい場合はここだけ変更
  google: {
    clientId:   "193049272380-famodefash4i4m26f6d5m33c5tlr6fvq.apps.googleusercontent.com",
    // 同期先カレンダーID（長崎医療センタースタッフ予定表）
    calendarId: "4v7p23of0rf03d2vj5sajckjkk@group.calendar.google.com",
  },

  org: {
    name: "長崎医療センター",
    dept: "総合診療科 レジデント",
  },

  // ─── 勤務表のルール ──────────────────────────────────
  rules: {
    midoriSlot: "w1",        // みどり兼任・大村在住者が入る週末スロット ("w1" または "w2")
    holidaySlots: 2,         // 祝日当番の人数 (1 または 2)
    deadlineDay: 15,         // 前月◯日が提出締切
    silverWeekMinDays: 4,    // 敬老の日を含む連休がこの日数以上なら「別枠 (SW)」扱い
  },

  // ─── 初期スタッフ（Firestore が空のときだけ書き込まれます）─
  //   omura: 大村在住 (みどり兼任可)   ueda: 上田記念 外勤の希望者   noDuty: 当番対象外 (管理者など)
  //   startYm/endYm: 在籍期間 ("2026-10" 形式、空なら無制限)
  seedStaff: [
    { id: 'r00', name: '森 隆浩',   email: 'takahiromori19800720@gmail.com', role: 'admin', status: 'active', omura: false, ueda: false, noDuty: true, colorIndex: 0,  startYm: '', endYm: '' },
    { id: 'r01', name: '大内田',    email: '', role: 'staff', status: 'active', omura: false, ueda: false, colorIndex: 1,  startYm: '2026-10', endYm: '' },
    { id: 'r02', name: '西浦 壮志', email: '', role: 'staff', status: 'active', omura: false, ueda: false, colorIndex: 2,  startYm: '', endYm: '' },
    { id: 'r03', name: '西浦 藍',   email: '', role: 'staff', status: 'active', omura: false, ueda: false, colorIndex: 3,  startYm: '', endYm: '' },
    { id: 'r04', name: '鋸崎',      email: '', role: 'staff', status: 'active', omura: false, ueda: true,  colorIndex: 4,  startYm: '', endYm: '' },
    { id: 'r05', name: '飯田',      email: '', role: 'staff', status: 'active', omura: false, ueda: false, colorIndex: 5,  startYm: '', endYm: '' },
    { id: 'r06', name: '藤原',      email: '', role: 'staff', status: 'active', omura: false, ueda: false, colorIndex: 6,  startYm: '', endYm: '' },
    { id: 'r07', name: '武内',      email: '', role: 'staff', status: 'active', omura: false, ueda: false, colorIndex: 7,  startYm: '', endYm: '' },
    { id: 'r08', name: '蒲原',      email: '', role: 'staff', status: 'active', omura: false, ueda: false, colorIndex: 8,  startYm: '', endYm: '' },
    { id: 'r09', name: '原田',      email: '', role: 'staff', status: 'active', omura: false, ueda: false, colorIndex: 9,  startYm: '', endYm: '' },
    { id: 'r10', name: '香川',      email: '', role: 'staff', status: 'active', omura: false, ueda: false, colorIndex: 10, startYm: '', endYm: '' },
  ],
};
