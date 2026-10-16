// Google 로그인 + Firebase Realtime Database 동기화.
// 로그인하면 단어장·시험 기록을 users/{uid}/ 아래에 저장하고, 로그아웃하면 브라우저 저장으로 돌아간다.
// 데이터 접근 권한은 database.rules.json(본인 uid만 읽기/쓰기)으로 막는다.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getDatabase, ref, get, set, update } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';

// 웹 앱 설정값은 공개되어도 되는 식별자다. 보안은 데이터베이스 규칙이 담당한다.
const firebaseConfig = {
  apiKey: 'AIzaSyDcOXkVAhsovtVR7cMv9yja5qcCLew9BLY',
  authDomain: 'english-vocab-syjang.firebaseapp.com',
  databaseURL: 'https://english-vocab-syjang-default-rtdb.firebaseio.com',
  projectId: 'english-vocab-syjang',
  storageBucket: 'english-vocab-syjang.firebasestorage.app',
  messagingSenderId: '178854686510',
  appId: '1:178854686510:web:ebff46fa2e6f461f1694bf',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'ko';
const db = getDatabase(app);

const ui = {
  avatar: document.getElementById('account-avatar'),
  name: document.getElementById('account-name'),
  status: document.getElementById('account-status'),
  login: document.getElementById('btn-login'),
  logout: document.getElementById('btn-logout'),
};

function setStatus(text, isError = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle('is-error', isError);
}

// Realtime Database는 undefined 값을 저장할 수 없고, 빈 배열은 null로 돌아온다.
const clean = (value) => JSON.parse(JSON.stringify(value ?? []));
const toArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : value ? Object.values(value) : []);

// ===== Firebase 저장 구조 =====
// users/{uid}/
//   word_list: [{ id, english, korean, example, date, accuracy }]   accuracy: 정답률(%), 시험 본 적 없으면 없음
//   exam_list: [{ id, date, test: [{ english, korean, correct, shown, answer, word_id }] }]
//   seed_version: 기본 단어 반영 버전 (새 기기에서 지운 기본 단어가 되살아나지 않도록)

function toWordList(list, exams) {
  const statsFor = buildWordStats(exams);
  return list.map((w) => {
    const s = statsFor(w);
    const item = { id: w.id, english: w.en, korean: w.ko, example: w.ex || '', date: w.date || timestamp() };
    if (s.total) item.accuracy = Math.round((s.correct / s.total) * 100);
    return item;
  });
}

function fromWordList(list) {
  return toArray(list).map((w) => ({ id: w.id || makeId(), en: w.english, ko: w.korean, ex: w.example || '', date: w.date }));
}

function toExamList(records) {
  return records.map((r) => ({
    id: r.id,
    date: timestamp(new Date(r.date)), // 예전 기록의 UTC("…Z") 날짜도 한국 시간 형식으로 맞춘다
    test: r.items.map((it) => {
      const item = { english: it.en, korean: it.ko, correct: it.correct };
      if (it.shown !== undefined) item.shown = it.shown;
      if (it.answer !== undefined) item.answer = it.answer;
      if (it.wordId) item.word_id = it.wordId;
      return item;
    }),
  }));
}

function fromExamList(list) {
  return toArray(list).map((e) => {
    const items = toArray(e.test).map((t) => {
      const it = { en: t.english, ko: t.korean, correct: !!t.correct };
      if (t.shown !== undefined) { it.shown = t.shown; it.isTrue = t.shown === t.korean; }
      if (t.answer !== undefined) it.answer = t.answer;
      if (t.word_id) it.wordId = t.word_id;
      return it;
    });
    return { id: e.id || makeId(), date: e.date, score: items.filter((it) => it.correct).length, total: items.length, items };
  });
}

// 단어를 바꾸든 시험을 보든 정답률이 함께 바뀌므로 두 목록을 한 번에 저장한다.
function cloudSource(uid) {
  let pending = 0;
  return {
    save() {
      pending++;
      setStatus('저장 중…');
      const history = loadHistory();
      update(ref(db, `users/${uid}`), clean({ word_list: toWordList(words, history), exam_list: toExamList(history) }))
        .then(() => { if (--pending === 0) setStatus('Firebase에 저장됨'); })
        .catch((err) => {
          pending--;
          console.error(err);
          setStatus('저장 실패 — 인터넷 연결을 확인해 주세요', true);
        });
    },
  };
}

// 처음 로그인한 계정이면 이 브라우저에 있던 단어장과 기록을 계정으로 옮긴다.
// 예전 구조(words / history / seedVersion)로 저장된 계정은 새 구조로 한 번 변환한다.
async function loadUserData(uid) {
  const userRef = ref(db, `users/${uid}`);
  const saved = (await get(userRef)).val();

  let data;
  let version;
  let note = 'Firebase와 동기화됨';
  let rewrite = false;

  if (saved === null) {
    data = localSource.load();
    version = SEED_VERSION;
    note = '이 브라우저의 단어장과 기록을 계정으로 옮겼어요';
    rewrite = true;
  } else if (saved.word_list === undefined && saved.words !== undefined) {
    data = { words: toArray(saved.words), history: toArray(saved.history) };
    version = saved.seedVersion || 0;
    rewrite = true;
  } else {
    data = { words: fromWordList(saved.word_list), history: fromExamList(saved.exam_list) };
    version = saved.seed_version || 0;
  }

  const seeded = applySeeds(data.words, version);
  data.words = seeded.words;

  if (rewrite || seeded.changed) {
    await set(userRef, clean({
      word_list: toWordList(data.words, data.history),
      exam_list: toExamList(data.history),
      seed_version: SEED_VERSION,
    }));
  }
  return { data, note };
}

function showGuest() {
  ui.avatar.hidden = true;
  ui.name.textContent = '게스트';
  setStatus('로그인하면 휴대폰·PC에서 단어장과 기록이 이어져요');
  ui.login.hidden = false;
  ui.login.disabled = false;
  ui.logout.hidden = true;
}

function showUser(user) {
  ui.avatar.src = user.photoURL || '';
  ui.avatar.hidden = !user.photoURL;
  ui.name.textContent = user.displayName || user.email || 'Google 계정';
  ui.login.hidden = true;
  ui.logout.hidden = false;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    setDataSource(null);
    showGuest();
    return;
  }
  showUser(user);
  setStatus('Firebase에서 불러오는 중…');
  try {
    const { data, note } = await loadUserData(user.uid);
    setDataSource(cloudSource(user.uid), data);
    setStatus(note);
  } catch (err) {
    console.error(err);
    setDataSource(null);
    setStatus('불러오기 실패 — 지금은 이 브라우저에 저장돼요', true);
  }
});

const LOGIN_ERRORS = {
  'auth/operation-not-allowed': 'Firebase 콘솔에서 Google 로그인이 아직 꺼져 있어요',
  'auth/configuration-not-found': 'Firebase 콘솔에서 Google 로그인이 아직 꺼져 있어요',
  'auth/unauthorized-domain': '이 주소는 Firebase 로그인 허용 도메인에 없어요',
  'auth/network-request-failed': '인터넷 연결을 확인해 주세요',
};

ui.login.addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  ui.login.disabled = true;
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider); // 팝업이 막힌 브라우저는 페이지 이동 방식으로
      return;
    }
    if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
      console.error(err);
      setStatus(LOGIN_ERRORS[err.code] || `로그인 실패 (${err.code})`, true);
    }
  } finally {
    ui.login.disabled = false;
  }
});

ui.logout.addEventListener('click', () => signOut(auth));

// 저장 구조 변환 함수 (점검·테스트용)
export { toWordList, fromWordList, toExamList, fromExamList };

ui.login.disabled = false;
