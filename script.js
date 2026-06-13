'use strict';

const app = document.getElementById('app');
const toast = document.getElementById('toast');
const aiModal = document.getElementById('aiModal');
const aiContent = document.getElementById('aiContent');
const settingsModal = document.getElementById('settingsModal');

const STORAGE = {
  score: 'ugb_score_v1',
  wrong: 'ugb_wrong_v1',
  apiKey: 'ugb_openai_key_v1',
  todayIndex: 'ugb_today_index_v1'
};

let questions = [];
let currentQuestion = null;
let currentMode = 'home';
let selectedAnswer = null;
let submitted = false;

const state = loadScore();

function loadScore() {
  const fallback = { totalScore: 0, solved: 0, correct: 0, solvedIds: [] };
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(STORAGE.score)) || {}) };
  } catch {
    return fallback;
  }
}

function saveScore() {
  localStorage.setItem(STORAGE.score, JSON.stringify(state));
}

function getWrongNotes() {
  try { return JSON.parse(localStorage.getItem(STORAGE.wrong)) || []; }
  catch { return []; }
}

function saveWrongNotes(notes) {
  localStorage.setItem(STORAGE.wrong, JSON.stringify(notes));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2400);
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

function sanitizeTutorHTML(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script, iframe, object, embed, link, style').forEach(el => el.remove());
  template.content.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      if (/^on/i.test(attr.name) || /javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    });
  });
  return template.innerHTML;
}

async function init() {
  bindGlobalEvents();
  try {
    const res = await fetch('questions.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('questions.json could not be loaded.');
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error('questions.json is empty.');
    questions = data.map(validateQuestion).filter(Boolean);
    if (questions.length === 0) throw new Error('No valid questions were found.');
    renderHome();
  } catch (error) {
    renderError(error.message || 'Failed to load the question database.');
  }
}

function validateQuestion(q) {
  if (!q || typeof q !== 'object') return null;
  if (!q.id || !q.type || !q.question || typeof q.answer === 'undefined') return null;
  if (!['multiple-choice', 'ox', 'short-answer'].includes(q.type)) return null;
  if (q.type === 'multiple-choice' && (!Array.isArray(q.choices) || q.choices.length < 2)) return null;
  return q;
}

function renderError(message) {
  app.innerHTML = `<section class="card"><h2>Something went wrong</h2><p class="feedback error">${escapeHTML(message)}</p><p>Please check that all files are in the same folder and run the app through a local server.</p></section>`;
}

function bindGlobalEvents() {
  document.getElementById('closeModal').addEventListener('click', () => aiModal.classList.add('hidden'));
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('closeSettings').addEventListener('click', () => settingsModal.classList.add('hidden'));
  document.getElementById('saveApiKey').addEventListener('click', () => {
    const key = document.getElementById('apiKeyInput').value.trim();
    if (!key) return showToast('Enter an API key first.');
    localStorage.setItem(STORAGE.apiKey, key);
    settingsModal.classList.add('hidden');
    showToast('API key saved.');
  });
  document.getElementById('clearApiKey').addEventListener('click', () => {
    localStorage.removeItem(STORAGE.apiKey);
    document.getElementById('apiKeyInput').value = '';
    showToast('API key cleared.');
  });
  [aiModal, settingsModal].forEach(modal => modal.addEventListener('click', e => {
    if (e.target === modal) modal.classList.add('hidden');
  }));
}

function openSettings() {
  document.getElementById('apiKeyInput').value = localStorage.getItem(STORAGE.apiKey) || '';
  settingsModal.classList.remove('hidden');
}

function renderHome() {
  currentMode = 'home';
  const accuracy = state.solved ? Math.round((state.correct / state.solved) * 100) : 0;
  const wrongCount = getWrongNotes().length;
  app.innerHTML = `
    <section class="home-grid">
      <article class="card home-card" data-action="today"><div><div class="big-icon">📘</div><h2>Today’s Question</h2><p>Continue studying questions 1 → 113 in order.</p></div></article>
      <article class="card home-card" data-action="random"><div><div class="big-icon">🎲</div><h2>Random Quiz</h2><p>Practice any question from the full local database.</p></div></article>
      <article class="card home-card" data-action="wrong"><div><div class="big-icon">📝</div><h2>Wrong Answer Note</h2><p>${wrongCount} question${wrongCount === 1 ? '' : 's'} saved for review.</p></div></article>
      <article class="card home-card" data-action="score"><div><div class="big-icon">🏆</div><h2>My Score</h2><p>Total Score: <strong>${state.totalScore}</strong></p></div></article>
    </section>
    <section class="card" style="margin-top:18px">
      <h2>Progress</h2>
      <div class="stats-grid">
        <div class="stat"><strong>${state.totalScore}</strong><span>Score</span></div>
        <div class="stat"><strong>${state.solved}</strong><span>Solved</span></div>
        <div class="stat"><strong>${state.correct}</strong><span>Correct</span></div>
        <div class="stat"><strong>${accuracy}%</strong><span>Accuracy</span></div>
      </div>
    </section>`;
  app.querySelectorAll('[data-action]').forEach(card => card.addEventListener('click', () => {
    const action = card.dataset.action;
    if (action === 'today') startQuiz(getTodaysQuestion(), 'today');
    if (action === 'random') startQuiz(getRandomQuestion(), 'random');
    if (action === 'wrong') renderWrongNote();
    if (action === 'score') renderScore();
  }));
}

function getTodayQuizIndex() {
  const saved = Number(localStorage.getItem(STORAGE.todayIndex));

  if (
    !Number.isInteger(saved) ||
    saved < 0 ||
    saved >= questions.length
  ) {
    return 0;
  }

  return saved;
}

function saveTodayQuizIndex(index) {
  const normalized =
    ((index % questions.length) + questions.length) %
    questions.length;

  localStorage.setItem(
    STORAGE.todayIndex,
    String(normalized)
  );
}

function getTodaysQuestion() {
  return questions[getTodayQuizIndex()];
}

function getNextTodayQuestion() {
  const nextIndex =
    getTodayQuizIndex() + 1;

  saveTodayQuizIndex(nextIndex);

  return getTodaysQuestion();
}

function getRandomQuestion() {
  return questions[Math.floor(Math.random() * questions.length)];
}

function startQuiz(question, mode = 'random') {
  currentQuestion = question;
  currentMode = mode;
  selectedAnswer = null;
  submitted = false;
  renderQuiz();
}

function renderQuiz() {
  const q = currentQuestion;
  if (!q) return renderHome();
  app.innerHTML = `
    <section class="card quiz-card">
      <div class="meta-row">
        <span class="pill">Question ${q.id} / ${questions.length}</span>
        <span class="pill">${escapeHTML(q.category)}</span>
        <span class="pill">${escapeHTML(q.type)}</span>
      </div>
      <h2>Question</h2>
      <div class="question-text">${escapeHTML(q.question)}</div>
      <div id="answerArea" class="answer-area"></div>
      <div id="feedbackArea"></div>
      <div id="explanationArea" class="hidden explanation"></div>
      <div class="button-bar">
        <button id="submitBtn" class="primary-btn" type="button">Submit Answer</button>
        <button id="explainBtn" class="secondary-btn" type="button">View Explanation</button>
        <button id="aiBtn" class="secondary-btn" type="button">Ask AI to Explain Simply</button>
        <button id="nextBtn" class="secondary-btn" type="button">Next Question</button>
        <button id="homeBtn" class="danger-outline-btn" type="button">Home</button>
      </div>
    </section>`;
  renderAnswerArea(q);
  document.getElementById('submitBtn').addEventListener('click', submitAnswer);
  document.getElementById('explainBtn').addEventListener('click', showExplanation);
  document.getElementById('aiBtn').addEventListener('click', askAI);
  document.getElementById('nextBtn')
  .addEventListener('click', () => {

    if (currentMode === 'today') {

      startQuiz(
        getNextTodayQuestion(),
        'today'
      );

    } else {

      startQuiz(
        getRandomQuestion(),
        'random'
      );

    }
  });
  document.getElementById('homeBtn').addEventListener('click', renderHome);
  if (q.type === 'short-answer') document.getElementById('submitBtn').disabled = true;
}

function renderAnswerArea(q) {
  const area = document.getElementById('answerArea');
  if (q.type === 'multiple-choice') {
    area.innerHTML = q.choices.map(c => `<button class="choice-btn" type="button" data-answer="${escapeHTML(c.key)}"><strong>${escapeHTML(c.key)}.</strong> ${escapeHTML(c.text)}</button>`).join('');
    area.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => selectButton(btn)));
  } else if (q.type === 'ox') {
    area.innerHTML = `<div class="ox-wrap"><button class="ox-btn" type="button" data-answer="O">O</button><button class="ox-btn" type="button" data-answer="X">X</button></div>`;
    area.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => selectButton(btn)));
  } else if (q.type === 'short-answer') {
    area.innerHTML = `
      <label class="field-label" for="shortInput">Your answer</label>
      <input id="shortInput" class="text-input" type="text" placeholder="Type your answer for memory practice" />
      <button id="revealBtn" class="primary-btn" type="button">Reveal Answer</button>`;
    document.getElementById('revealBtn').addEventListener('click', revealShortAnswer);
  } else {
    area.innerHTML = `<p class="feedback error">Unsupported question type: ${escapeHTML(q.type)}</p>`;
  }
}

function selectButton(btn) {
  if (submitted) return;
  selectedAnswer = btn.dataset.answer;
  document.querySelectorAll('.choice-btn,.ox-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

function submitAnswer() {
  if (!currentQuestion || submitted) return;
  if (!selectedAnswer) return setFeedback('Please select an answer first.', 'warn');
  submitted = true;
  const isCorrect = selectedAnswer === currentQuestion.answer;
  recordSolved(isCorrect);
  if (isCorrect) {
    removeWrong(currentQuestion.id);
    setFeedback('Correct! +10 points', 'success');
  } else {
    addWrong(currentQuestion);
    setFeedback(`Incorrect. Correct answer: ${escapeHTML(currentQuestion.answer)}`, 'error');
  }
}

function recordSolved(isCorrect) {
  state.solved += 1;
  if (isCorrect) {
    state.correct += 1;
    state.totalScore += 10;
  }
  if (!state.solvedIds.includes(currentQuestion.id)) state.solvedIds.push(currentQuestion.id);
  saveScore();
}

function setFeedback(message, type) {
  document.getElementById('feedbackArea').innerHTML = `<div class="feedback ${type}">${message}</div>`;
}

function showExplanation() {
  if (!currentQuestion) return;
  const box = document.getElementById('explanationArea');
  box.innerHTML = `<strong>Correct Answer:</strong> ${escapeHTML(currentQuestion.answer)}<br><br><strong>Explanation:</strong> ${escapeHTML(currentQuestion.explanation)}`;
  box.classList.remove('hidden');
}

function revealShortAnswer() {
  const userText = document.getElementById('shortInput').value.trim();
  const prefix = userText ? `<strong>Your answer:</strong> ${escapeHTML(userText)}<br><br>` : '';
  document.getElementById('feedbackArea').innerHTML = `<div class="feedback warn">Short-answer questions are not automatically graded for spelling.</div>`;
  const box = document.getElementById('explanationArea');
  box.innerHTML = `${prefix}<strong>Official Answer:</strong> ${escapeHTML(currentQuestion.answer)}<br><br><strong>Explanation:</strong> ${escapeHTML(currentQuestion.explanation)}`;
  box.classList.remove('hidden');
}

function addWrong(q) {
  const notes = getWrongNotes();
  if (!notes.some(item => item.id === q.id)) {
    notes.push({ id: q.id, savedAt: new Date().toISOString() });
    saveWrongNotes(notes);
  }
}

function removeWrong(id) {
  saveWrongNotes(getWrongNotes().filter(item => item.id !== id));
}

function renderWrongNote() {
  const notes = getWrongNotes();
  const wrongQuestions = notes.map(n => questions.find(q => q.id === n.id)).filter(Boolean);
  app.innerHTML = `
    <section class="card">
      <div class="row" style="justify-content:space-between;gap:12px;flex-wrap:wrap"><h2>Wrong Answer Note</h2><button id="homeBtn" class="secondary-btn" type="button">Home</button></div>
      <div class="list">${wrongQuestions.length ? wrongQuestions.map(q => `
        <article class="list-item">
          <strong>Q${q.id}. ${escapeHTML(q.category)}</strong>
          <p>${escapeHTML(q.question.slice(0, 260))}${q.question.length > 260 ? '…' : ''}</p>
          <div class="list-actions">
            <button class="primary-btn" type="button" data-retry="${q.id}">Retry Question</button>
            <button class="danger-outline-btn" type="button" data-remove="${q.id}">Remove</button>
          </div>
        </article>`).join('') : '<div class="empty">No wrong answers yet. Great job!</div>'}</div>
    </section>`;
  document.getElementById('homeBtn').addEventListener('click', renderHome);
  app.querySelectorAll('[data-retry]').forEach(btn => btn.addEventListener('click', () => startQuiz(questions.find(q => q.id === Number(btn.dataset.retry)), 'wrong')));
  app.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => { removeWrong(Number(btn.dataset.remove)); renderWrongNote(); }));
}

function renderScore() {
  const accuracy = state.solved ? ((state.correct / state.solved) * 100).toFixed(1) : '0.0';
  app.innerHTML = `
    <section class="card">
      <h2>My Score</h2>
      <div class="stats-grid">
        <div class="stat"><strong>${state.totalScore}</strong><span>Total Score</span></div>
        <div class="stat"><strong>${state.solved}</strong><span>Solved Questions</span></div>
        <div class="stat"><strong>${state.correct}</strong><span>Correct Questions</span></div>
        <div class="stat"><strong>${accuracy}%</strong><span>Accuracy</span></div>
      </div>
      <div class="button-bar" style="margin-top:18px">
        <button id="resetScore" class="danger-outline-btn" type="button">Reset Score</button>
        <button id="homeBtn" class="secondary-btn" type="button">Home</button>
      </div>
    </section>`;
  document.getElementById('homeBtn').addEventListener('click', renderHome);
  document.getElementById('resetScore').addEventListener('click', () => {
    if (!confirm('Reset all score data?')) return;
    Object.assign(state, { totalScore: 0, solved: 0, correct: 0, solvedIds: [] });
    saveScore();
    renderScore();
  });
}

async function askAI() {
  const apiKey = localStorage.getItem(STORAGE.apiKey);
  if (!apiKey) {
    openSettings();
    showToast('Save your OpenAI API key first.');
    return;
  }
  aiContent.innerHTML = '<p class="muted">Generating a simple explanation...</p>';
  aiModal.classList.remove('hidden');
  const q = currentQuestion;
  const prompt = `You are an AI tutor for middle school students.\n\nExplain using:\n1. Correct Answer\n2. One-line Summary\n3. Easy Explanation\n4. Memory Tip\n5. Similar Question\n\nUse simple English. Return structured HTML only.\n\nQuestion: ${q.question}\nCorrect Answer: ${q.answer}\nExplanation: ${q.explanation}`;
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'gpt-4.1-mini', input: prompt, temperature: 0.3 })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `API request failed with status ${res.status}.`);
    const html = data.output_text || data.output?.flatMap(item => item.content || []).map(c => c.text || '').join('') || '';
    aiContent.innerHTML = sanitizeTutorHTML(html || '<p>No explanation was returned.</p>');
  } catch (error) {
    aiContent.innerHTML = `<div class="feedback error">${escapeHTML(error.message || 'Network or API error. Please try again.')}</div>`;
  }
}

init();
