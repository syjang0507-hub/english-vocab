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

function cloudSource(uid) {
  let pending = 0;
  return {
    save(key, value) {
      pending++;
      setStatus('저장 중…');
      set(ref(db, `users/${uid}/${key}`), clean(value))
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
async function loadUserData(uid) {
  const userRef = ref(db, `users/${uid}`);
  const saved = (await get(userRef)).val();

  if (saved === null) {
    const local = localSource.load();
    await set(userRef, clean({ words: local.words, history: local.history, seedVersion: SEED_VERSION }));
    return { data: local, migrated: true };
  }

  const { words: list, changed } = applySeeds(toArray(saved.words), saved.seedVersion || 0);
  if (changed) await update(userRef, { words: clean(list), seedVersion: SEED_VERSION });
  return { data: { words: list, history: toArray(saved.history) }, migrated: false };
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
    const { data, migrated } = await loadUserData(user.uid);
    setDataSource(cloudSource(user.uid), data);
    setStatus(migrated ? '이 브라우저의 단어장과 기록을 계정으로 옮겼어요' : 'Firebase와 동기화됨');
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

ui.login.disabled = false;
