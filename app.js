// ===== 저장소 =====
const WORDS_KEY = 'vocab.words';
const HISTORY_KEY = 'vocab.history';
const QUIZ_SIZE = 10;

// 기본 단어 데이터는 words.js에 있다 (SAMPLE_WORDS, LEGACY_SAMPLE_WORDS).
// 목록을 바꾸면 SEED_VERSION을 올린다. 기존 사용자에게는 업데이트 시 한 번 반영된다.
const SEED_VERSION_KEY = 'vocab.seedVersion';
const SEED_VERSION = 3;

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 불가 환경(시크릿 모드 등)에서도 앱은 계속 동작
  }
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadWords() {
  let words = readJSON(WORDS_KEY, []);
  if (readJSON(SEED_VERSION_KEY, 0) < SEED_VERSION) {
    // 손대지 않은 예전 기본 단어(일반 영어)는 정리하고, 직접 추가·수정한 단어는 남긴다.
    const legacy = new Set(LEGACY_SAMPLE_WORDS.map(([en, ko]) => `${en}|${ko}`));
    const userWords = words.filter((w) => !legacy.has(`${w.en}|${w.ko}`));
    const existing = new Set(userWords.map((w) => w.en.toLowerCase()));
    const seeds = SAMPLE_WORDS
      .filter(([en]) => !existing.has(en.toLowerCase()))
      .map(([en, ko, ex]) => ({ id: makeId(), en, ko, ex }));
    // 직접 추가한 단어는 등록일순 맨 위에 그대로 둔다.
    words = [...userWords, ...seeds];
    saveWords(words);
    writeJSON(SEED_VERSION_KEY, SEED_VERSION);
  }
  return words;
}
function saveWords(words) { writeJSON(WORDS_KEY, words); }
function loadHistory() { return readJSON(HISTORY_KEY, []); }
function saveHistory(history) { writeJSON(HISTORY_KEY, history); }

let words = loadWords();

// ===== 화면 전환 =====
const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  $('home-notice').textContent = '';
  if (name === 'home') renderHomeStats();
  if (name === 'history') renderHistory();
  window.scrollTo(0, 0);
}

document.querySelectorAll('[data-go]').forEach((btn) => {
  btn.addEventListener('click', () => showScreen(btn.dataset.go));
});

$('btn-start').addEventListener('click', startQuiz);
$('btn-words').addEventListener('click', () => {
  closeAddForm();
  editingId = null;
  renderWordList();
  showScreen('words');
});
$('btn-history').addEventListener('click', () => showScreen('history'));
$('btn-result-done').addEventListener('click', (e) => showScreen(e.currentTarget.dataset.target));

function renderHomeStats() {
  const history = loadHistory();
  const correct = history.reduce((sum, r) => sum + r.score, 0);
  const total = history.reduce((sum, r) => sum + r.total, 0);
  $('stat-words').textContent = words.length;
  $('stat-tests').textContent = history.length;
  $('stat-rate').textContent = total ? `${Math.round((correct / total) * 100)}%` : '-';
}

// ===== 정답률 =====
// 시험 문항은 wordId로 단어와 연결한다 (단어를 편집해도 기록 유지).
// wordId가 없는 예전 기록은 영어 단어로 매칭한다.
function buildWordStats() {
  const byId = new Map();
  const byEn = new Map();
  const add = (map, key, correct) => {
    const s = map.get(key) || { correct: 0, total: 0 };
    s.total++;
    if (correct) s.correct++;
    map.set(key, s);
  };
  loadHistory().forEach((rec) => rec.items.forEach((it) => {
    if (it.wordId) add(byId, it.wordId, it.correct);
    else add(byEn, it.en.toLowerCase(), it.correct);
  }));
  return (word) => {
    const a = byId.get(word.id) || { correct: 0, total: 0 };
    const b = byEn.get(word.en.toLowerCase()) || { correct: 0, total: 0 };
    return { correct: a.correct + b.correct, total: a.total + b.total };
  };
}

function rateLevel(pct) {
  return pct >= 80 ? 'high' : pct >= 50 ? 'mid' : 'low';
}

function rateBadge({ correct, total }) {
  if (!total) return el('span', 'rate rate-none', '기록 없음');
  const pct = Math.round((correct / total) * 100);
  const badge = el('span', `rate rate-${rateLevel(pct)}`, `${pct}%`);
  badge.appendChild(el('small', '', `${correct}/${total}`));
  return badge;
}

// ===== 시험 =====
// 문제마다 실제 뜻 또는 다른 단어의 뜻(오답 보기)을 보여주고,
// 사용자가 "맞음/틀림"으로 판단한다. 판단이 맞으면 정답, 틀리면 오답.
const FAKE_RATE = 0.5;
const FEEDBACK_MS = { correct: 700, wrong: 1500 };

// quiz = { questions: [{wordId, en, ko, shown, isTrue}], index, answers: [bool], locked }
let quiz = null;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startQuiz() {
  if (words.length < QUIZ_SIZE) {
    showScreen('home');
    $('home-notice').textContent =
      `단어를 ${QUIZ_SIZE}개 이상 등록하세요. (현재 ${words.length}개) — 단어 관리에서 추가할 수 있어요.`;
    return;
  }
  const questions = shuffle(words).slice(0, QUIZ_SIZE).map(makeQuestion);
  quiz = { questions, index: 0, answers: [], locked: false };
  showScreen('quiz');
  renderQuestion();
}

function makeQuestion({ id, en, ko, ex }) {
  const decoys = words.filter((w) => w.id !== id && w.ko !== ko);
  const fake = decoys.length > 0 && Math.random() < FAKE_RATE;
  const shown = fake ? decoys[Math.floor(Math.random() * decoys.length)].ko : ko;
  return { wordId: id, en, ko, ex: ex || '', shown, isTrue: !fake };
}

// 예문 속 표현을 굵게 표시한다. "statement of work (SOW)"처럼 괄호 약어가 있으면
// 본 표현 → 약어 순으로 찾고, 단어마다 활용형("kick off" → "kicked off")까지 허용한다.
function termPattern(term) {
  const parts = term.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[a-z]*');
  return new RegExp('\\b' + parts.join('\\s+'), 'i');
}

function renderExample(target, en, ex) {
  target.replaceChildren();
  if (!ex) return;
  const abbr = (en.match(/\(([^)]+)\)/) || [])[1];
  const base = en.replace(/\s*\([^)]*\)/, '').split(' / ')[0];
  const match = [base, abbr].filter(Boolean).map((t) => ex.match(termPattern(t))).find(Boolean);
  if (!match) {
    target.textContent = ex;
    return;
  }
  const at = match.index;
  const end = at + match[0].length;
  target.append(ex.slice(0, at), el('strong', '', ex.slice(at, end)), ex.slice(end));
}

function renderQuestion() {
  const q = quiz.questions[quiz.index];
  $('quiz-progress').textContent = `${quiz.index + 1} / ${QUIZ_SIZE}`;
  $('quiz-progress-fill').style.width = `${(quiz.index / QUIZ_SIZE) * 100}%`;
  $('quiz-word').textContent = q.en;
  renderExample($('quiz-example'), q.en, q.ex);
  $('quiz-meaning').textContent = q.shown;
  $('quiz-card').className = 'card quiz-card';
  $('quiz-feedback').textContent = '';
  $('quiz-feedback').className = 'quiz-feedback';
  $('btn-correct').disabled = false;
  $('btn-wrong').disabled = false;
  quiz.locked = false;
}

// answer: 사용자가 "맞음"을 눌렀으면 true
function answer(saysTrue) {
  if (quiz.locked) return;
  quiz.locked = true;
  const q = quiz.questions[quiz.index];
  const correct = saysTrue === q.isTrue;
  quiz.answers.push(saysTrue);

  $('btn-correct').disabled = true;
  $('btn-wrong').disabled = true;
  $('quiz-card').classList.add(correct ? 'is-correct' : 'is-wrong');
  const fb = $('quiz-feedback');
  fb.className = 'quiz-feedback ' + (correct ? 'fb-correct' : 'fb-wrong');
  fb.textContent = correct ? '정답!' : `오답 — 실제 뜻: ${q.ko}`;

  setTimeout(() => {
    if (!quiz) return; // 피드백 중 그만두기
    quiz.index++;
    if (quiz.index < QUIZ_SIZE) renderQuestion();
    else finishQuiz();
  }, correct ? FEEDBACK_MS.correct : FEEDBACK_MS.wrong);
}

$('btn-correct').addEventListener('click', () => answer(true));
$('btn-wrong').addEventListener('click', () => answer(false));

$('btn-quit').addEventListener('click', () => {
  if (confirm('시험을 그만둘까요? 이번 기록은 저장되지 않습니다.')) {
    quiz = null;
    showScreen('home');
  }
});

function finishQuiz() {
  const items = quiz.questions.map((q, i) => ({
    ...q,
    answer: quiz.answers[i],
    correct: quiz.answers[i] === q.isTrue,
  }));
  const score = items.filter((it) => it.correct).length;
  const record = { id: makeId(), date: new Date().toISOString(), score, total: items.length, items };

  const history = loadHistory();
  history.push(record);
  saveHistory(history);

  renderResult(record);
  quiz = null;
  showScreen('result');
}

// ===== 결과 표 (결과 화면/기록 상세 공용) =====
function fillResultRows(tbody, items) {
  tbody.replaceChildren();
  items.forEach((it, i) => {
    const tr = document.createElement('tr');

    // 예전 기록(자가 채점 방식)에는 shown/answer가 없다.
    const shown = it.shown ?? it.ko;
    const tdShown = el('td', 'td-ko', shown);
    if (it.isTrue === false) tdShown.appendChild(el('small', 'real-meaning', `실제 뜻: ${it.ko}`));

    const myAnswer = it.answer === undefined ? '-' : it.answer ? '맞음' : '틀림';

    const tdMark = el('td');
    tdMark.appendChild(el('span', 'mark ' + (it.correct ? 'mark-o' : 'mark-x'), it.correct ? '정답' : '오답'));
    tr.append(el('td', 'td-num', String(i + 1)), el('td', 'td-en', it.en), tdShown, el('td', 'td-answer', myAnswer), tdMark);
    tbody.appendChild(tr);
  });
}

function resultMessage(pct) {
  if (pct === 100) return '완벽해요! 🎉';
  if (pct >= 80) return '아주 잘했어요! 👏';
  if (pct >= 50) return '좋아요, 조금만 더! 💪';
  return '틀린 단어를 다시 복습해 봐요 📖';
}

// fromHistory: 시험 기록에서 연 경우 상단에 회차·날짜와 목록으로 돌아가기 버튼을 보여준다.
function renderResult(record, fromHistory = null) {
  const pct = Math.round((record.score / record.total) * 100);
  $('result-topbar').hidden = !fromHistory;
  if (fromHistory) $('result-title').textContent = `${fromHistory.round}회차 · ${formatDate(record.date)}`;
  $('btn-result-done').textContent = fromHistory ? '목록으로' : '메인으로';
  $('btn-result-done').dataset.target = fromHistory ? 'history' : 'home';
  $('result-score').textContent = record.score;
  $('result-total').textContent = ` / ${record.total}`;
  $('result-ring').style.setProperty('--pct', pct);
  $('result-msg').textContent = resultMessage(pct);
  fillResultRows($('result-body'), record.items);
}

// ===== 단어 관리 =====
let editingId = null;

function isDuplicate(en, exceptId = null) {
  return words.some((w) => w.id !== exceptId && w.en.toLowerCase() === en.toLowerCase());
}

// 입력값에 문제가 있으면 해당 입력칸에 브라우저 기본 말풍선으로 알려준다.
function validateWord(enInput, koInput, exceptId = null) {
  const en = enInput.value.trim();
  const ko = koInput.value.trim();
  [enInput, koInput].forEach((i) => i.setCustomValidity(''));

  if (!en) enInput.setCustomValidity('영어 단어를 입력하세요.');
  else if (isDuplicate(en, exceptId)) enInput.setCustomValidity('이미 등록된 단어입니다.');
  else if (!ko) koInput.setCustomValidity('한글 뜻을 입력하세요.');

  const invalid = [enInput, koInput].find((i) => !i.checkValidity());
  if (invalid) {
    invalid.reportValidity();
    invalid.addEventListener('input', () => invalid.setCustomValidity(''), { once: true });
    return null;
  }
  return { en, ko };
}

// ===== 정렬 =====
// words 배열은 등록 최신순으로 저장된다 (새 단어는 맨 앞).
// 같은 탭을 다시 누르면 방향이 바뀐다. 선택은 브라우저에 기억한다.
const SORT_KEY = 'vocab.wordSort';
const SORT_LABELS = {
  date: { desc: '최신순', asc: '오래된순' },
  rate: { desc: '높은순', asc: '낮은순' },
};
let wordSort = readJSON(SORT_KEY, { key: 'date', dir: 'desc' });

function sortedWords(statsFor) {
  const order = new Map(words.map((w, i) => [w.id, i]));
  const sign = wordSort.dir === 'desc' ? 1 : -1;
  const byDate = (a, b) => (order.get(a.id) - order.get(b.id)) * sign;
  if (wordSort.key === 'date') return words.slice().sort(byDate);

  const rate = (w) => {
    const s = statsFor(w);
    return s.total ? s.correct / s.total : null;
  };
  return words.slice().sort((a, b) => {
    const ra = rate(a);
    const rb = rate(b);
    if (ra === null && rb === null) return order.get(a.id) - order.get(b.id);
    if (ra === null || rb === null) return ra === null ? 1 : -1; // 기록 없는 단어는 항상 맨 뒤
    return (rb - ra) * sign || statsFor(b).total - statsFor(a).total || order.get(a.id) - order.get(b.id);
  });
}

function renderSortTabs() {
  document.querySelectorAll('.sort-tab').forEach((tab) => {
    const active = tab.dataset.sort === wordSort.key;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', active);
    tab.querySelector('.sort-dir').textContent = active ? (wordSort.dir === 'desc' ? '↓' : '↑') : '';
    tab.title = active ? SORT_LABELS[tab.dataset.sort][wordSort.dir] : '';
  });
}

function setWordSort(key, dir) {
  wordSort = { key, dir };
  writeJSON(SORT_KEY, wordSort);
}

document.querySelectorAll('.sort-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const key = tab.dataset.sort;
    const dir = wordSort.key === key && wordSort.dir === 'desc' ? 'asc' : 'desc';
    setWordSort(key, dir);
    renderWordList();
  });
});

function renderWordList(highlightId = null) {
  const tbody = $('word-body');
  tbody.replaceChildren();
  renderSortTabs();
  $('word-count').textContent = `총 ${words.length}개 · ${SORT_LABELS[wordSort.key][wordSort.dir]}`;

  if (words.length === 0) {
    const tr = document.createElement('tr');
    const td = el('td', 'empty', '등록된 단어가 없습니다.');
    td.colSpan = 4;
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  const statsFor = buildWordStats();
  sortedWords(statsFor).forEach((w) => {
    tbody.appendChild(w.id === editingId ? editRow(w) : viewRow(w, statsFor(w), w.id === highlightId));
  });
}

function viewRow(w, stats, highlight) {
  const tr = el('tr', highlight ? 'row-new' : '');

  const tdRate = el('td');
  tdRate.appendChild(rateBadge(stats));

  const edit = el('button', 'btn btn-sm btn-edit', '편집');
  edit.addEventListener('click', () => startEdit(w.id));
  const del = el('button', 'btn btn-sm btn-del', '삭제');
  del.addEventListener('click', () => removeWord(w.id));
  const actions = el('span', 'row-actions');
  actions.append(edit, del);
  const tdActions = el('td');
  tdActions.appendChild(actions);

  // 표현 아래에 예문을, 모바일에서는 뜻 열을 숨기고 뜻도 함께 보여준다.
  const tdEn = el('td', 'td-en', w.en);
  tdEn.appendChild(el('small', 'td-ko-sub', w.ko));
  if (w.ex) {
    const ex = el('small', 'td-ex');
    renderExample(ex, w.en, w.ex);
    tdEn.appendChild(ex);
  }
  tr.append(tdEn, el('td', 'td-ko', w.ko), tdRate, tdActions);
  return tr;
}

function editRow(w) {
  const tr = el('tr', 'row-editing');
  const enInput = el('input', 'edit-input');
  enInput.value = w.en;
  enInput.setAttribute('aria-label', '영어 단어');
  const koInput = el('input', 'edit-input');
  koInput.value = w.ko;
  koInput.setAttribute('aria-label', '한글 뜻');
  const exInput = el('input', 'edit-input input-wide');
  exInput.value = w.ex || '';
  exInput.placeholder = '예문 (선택)';
  exInput.setAttribute('aria-label', '예문');

  const save = () => {
    const value = validateWord(enInput, koInput, w.id);
    if (!value) return;
    Object.assign(w, value, { ex: exInput.value.trim() });
    saveWords(words);
    editingId = null;
    renderWordList(w.id);
  };
  const cancel = () => { editingId = null; renderWordList(); };

  [enInput, koInput, exInput].forEach((input) => input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') cancel();
  }));

  const saveBtn = el('button', 'btn btn-sm btn-primary', '저장');
  saveBtn.addEventListener('click', save);
  const cancelBtn = el('button', 'btn btn-sm', '취소');
  cancelBtn.addEventListener('click', cancel);
  const actions = el('span', 'row-actions');
  actions.append(saveBtn, cancelBtn);

  const tdInputs = el('td');
  tdInputs.colSpan = 3;
  const fields = el('div', 'edit-fields');
  fields.append(enInput, koInput, exInput);
  tdInputs.appendChild(fields);
  const tdActions = el('td');
  tdActions.appendChild(actions);
  tr.append(tdInputs, tdActions);

  requestAnimationFrame(() => { enInput.focus(); enInput.select(); });
  return tr;
}

function startEdit(id) {
  editingId = id;
  renderWordList();
}

function removeWord(id) {
  words = words.filter((w) => w.id !== id);
  saveWords(words);
  if (editingId === id) editingId = null;
  renderWordList();
}

$('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = validateWord($('input-en'), $('input-ko'));
  if (!value) return;

  const word = { id: makeId(), ...value, ex: $('input-ex').value.trim() };
  words.unshift(word);
  saveWords(words);
  closeAddForm();
  setWordSort('date', 'desc'); // 새 단어가 맨 위에 보이도록
  renderWordList(word.id);
});

function openAddForm() {
  $('add-form').hidden = false;
  $('btn-open-add').hidden = true;
  $('input-en').focus();
}

function closeAddForm() {
  $('add-form').hidden = true;
  $('btn-open-add').hidden = false;
  $('input-en').value = '';
  $('input-ko').value = '';
  $('input-ex').value = '';
}

$('btn-open-add').addEventListener('click', openAddForm);
$('btn-cancel-add').addEventListener('click', closeAddForm);

// ===== 시험 기록 =====
function formatDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderHistory() {
  const list = $('history-list');
  list.replaceChildren();
  const history = loadHistory();

  if (history.length === 0) {
    list.appendChild(el('li', 'history-empty', '아직 시험 기록이 없습니다.'));
    return;
  }

  history.slice().reverse().forEach((rec, idx) => {
    const li = el('li', 'history-item');
    const pct = Math.round((rec.score / rec.total) * 100);

    const head = el('button', 'history-head');
    const info = el('span', 'history-info');
    info.append(
      el('strong', '', `${history.length - idx}회차 · ${rec.score} / ${rec.total}`),
      el('small', '', formatDate(rec.date)),
    );
    head.append(el('span', `history-badge rate-${rateLevel(pct)}`, `${pct}%`), info, el('span', 'history-chevron', '›'));
    head.addEventListener('click', () => {
      renderResult(rec, { round: history.length - idx });
      showScreen('result');
    });

    li.appendChild(head);
    list.appendChild(li);
  });
}

renderHomeStats();
