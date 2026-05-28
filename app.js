(() => {
  "use strict";

  const TOTAL_STAGES = 50;
  const QUESTIONS_PER_STAGE = 30;
  const PASS_PERCENT = 70;
  const STORAGE_KEY = "jt_sem2_single_game_progress_v2";

  const stageRanges = [
    { start: 1, end: 5, plan: { 1: 20, 2: 10 } },
    { start: 6, end: 10, plan: { 1: 14, 2: 12, 3: 4 } },
    { start: 11, end: 15, plan: { 2: 18, 1: 6, 3: 6 } },
    { start: 16, end: 20, plan: { 2: 12, 3: 12, 4: 6 } },
    { start: 21, end: 25, plan: { 3: 16, 2: 6, 4: 8 } },
    { start: 26, end: 30, plan: { 3: 10, 4: 12, 5: 8 } },
    { start: 31, end: 35, plan: { 4: 16, 3: 6, 5: 8 } },
    { start: 36, end: 40, plan: { 4: 10, 5: 12, 6: 8 } },
    { start: 41, end: 45, plan: { 5: 14, 6: 10, 4: 6 } },
    { start: 46, end: 50, plan: { 6: 10, 7: 8, 8: 6, 9: 4, 10: 2 } }
  ];

  const bank = window.BANK_JT_SEM2 || null;

  const el = {
    playerName: document.getElementById("playerName"),
    playerNamePreview: document.getElementById("playerNamePreview"),
    startBtn: document.getElementById("startBtn"),
    rerollBtn: document.getElementById("rerollBtn"),
    submitBtn: document.getElementById("submitBtn"),

    stageMap: document.getElementById("stageMap"),

    quizTitle: document.getElementById("quizTitle"),
    quizSubtitle: document.getElementById("quizSubtitle"),
    quizForm: document.getElementById("quizForm"),

    currentStagePill: document.getElementById("currentStagePill"),
    questionCountPill: document.getElementById("questionCountPill"),

    currentStageText: document.getElementById("currentStageText"),
    unlockedStageText: document.getElementById("unlockedStageText"),
    timerText: document.getElementById("timerText"),

    answerProgressBar: document.getElementById("answerProgressBar"),
    answerProgressText: document.getElementById("answerProgressText"),
    stageProgressBar: document.getElementById("stageProgressBar"),
    stageProgressText: document.getElementById("stageProgressText"),

    resultSummary: document.getElementById("resultSummary"),
    wrongList: document.getElementById("wrongList"),
    resultCard: document.getElementById("resultCard")
  };

  const state = {
    playerName: "",
    unlockedStage: 1,
    currentStage: 1,
    stageQuestionSet: [],
    timerSec: 0,
    timerHandle: null
  };

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      state.playerName = saved.playerName || "";
      state.unlockedStage = Math.min(TOTAL_STAGES, Math.max(1, Number(saved.unlockedStage || 1)));
      state.currentStage = Math.min(state.unlockedStage, Math.max(1, Number(saved.currentStage || 1)));
    } catch (err) {
      console.warn("讀取進度失敗", err);
    }
  }

  function saveProgress() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        playerName: state.playerName,
        unlockedStage: state.unlockedStage,
        currentStage: state.currentStage
      })
    );
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${pad(m)}:${pad(s)}`;
  }

  function startTimer() {
    stopTimer();
    state.timerSec = 0;
    el.timerText.textContent = "00:00";
    state.timerHandle = setInterval(() => {
      state.timerSec += 1;
      el.timerText.textContent = formatTime(state.timerSec);
    }, 1000);
  }

  function stopTimer() {
    if (state.timerHandle) {
      clearInterval(state.timerHandle);
      state.timerHandle = null;
    }
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function getStagePlan(stage) {
    return stageRanges.find(r => stage >= r.start && stage <= r.end)?.plan || { 1: 30 };
  }

  function normalizeQuestion(q, idx) {
    const options = Array.isArray(q.options) ? q.options.slice(0, 4) : [];
    while (options.length < 4) {
      options.push(`選項${String.fromCharCode(65 + options.length)}`);
    }

    let answerIndex = 0;
    if (typeof q.answer === "number") {
      answerIndex = q.answer;
    } else if (typeof q.answer === "string") {
      const t = q.answer.trim().toUpperCase();
      if (["A", "B", "C", "D"].includes(t)) {
        answerIndex = ["A", "B", "C", "D"].indexOf(t);
      } else {
        const found = options.findIndex(op => String(op).trim() === String(q.answer).trim());
        answerIndex = found >= 0 ? found : 0;
      }
    }

    return {
      id: q.id || `jt-sem2-${idx + 1}`,
      question: q.question || `未命名題目 ${idx + 1}`,
      options,
      answer: Math.min(3, Math.max(0, Number(answerIndex || 0))),
      explanation: q.explanation || "本題未提供解析。",
      diff: Math.min(10, Math.max(1, Number(q.diff || 1)))
    };
  }

  function getAllQuestions() {
    if (!bank || !Array.isArray(bank.questions)) return [];
    return bank.questions.map(normalizeQuestion);
  }

  function pickQuestionsForStage(stage) {
    const all = getAllQuestions();
    if (!all.length) return [];

    const byDiff = new Map();
    all.forEach(q => {
      if (!byDiff.has(q.diff)) byDiff.set(q.diff, []);
      byDiff.get(q.diff).push(q);
    });

    const usedIds = new Set();
    const picked = [];
    const plan = getStagePlan(stage);

    function takeFromDiff(targetDiff, count) {
      let taken = 0;
      let radius = 0;
      const tried = new Set();

      while (taken < count && tried.size < 20) {
        const tryDiffs = radius === 0 ? [targetDiff] : [targetDiff - radius, targetDiff + radius];

        for (const d of tryDiffs) {
          if (d < 1 || d > 10 || tried.has(d)) continue;
          tried.add(d);

          const pool = shuffle((byDiff.get(d) || []).filter(q => !usedIds.has(q.id)));
          for (const q of pool) {
            if (taken >= count) break;
            usedIds.add(q.id);
            picked.push(q);
            taken += 1;
          }
        }

        radius += 1;
      }
    }

    Object.entries(plan).forEach(([diff, count]) => {
      takeFromDiff(Number(diff), Number(count));
    });

    if (picked.length < QUESTIONS_PER_STAGE) {
      const remain = shuffle(all.filter(q => !usedIds.has(q.id)));
      for (const q of remain) {
        picked.push(q);
        usedIds.add(q.id);
        if (picked.length >= QUESTIONS_PER_STAGE) break;
      }
    }

    return shuffle(picked).slice(0, QUESTIONS_PER_STAGE);
  }

  function renderStageMap() {
    el.stageMap.innerHTML = "";
    for (let i = 1; i <= TOTAL_STAGES; i++) {
      const node = document.createElement("div");
      node.className = "stage-node";

      if (i < state.currentStage && i <= state.unlockedStage) {
        node.classList.add("stage-node--passed");
      } else if (i === state.currentStage) {
        node.classList.add("stage-node--current");
      } else if (i > state.unlockedStage) {
        node.classList.add("stage-node--locked");
      }

      node.innerHTML = `<div>第 ${i} 關</div><small>${i <= state.unlockedStage ? "可挑戰" : "未解鎖"}</small>`;
      el.stageMap.appendChild(node);
    }
  }

  function renderStatus() {
    el.playerName.value = state.playerName;
    el.playerNamePreview.textContent = state.playerName || "未設定";
    el.currentStageText.textContent = `第 ${state.currentStage} 關`;
    el.unlockedStageText.textContent = `第 ${state.unlockedStage} 關`;
    el.currentStagePill.textContent = `第 ${state.currentStage} 關`;
    el.stageProgressText.textContent = `${state.unlockedStage} / ${TOTAL_STAGES}`;
    el.stageProgressBar.style.width = `${(state.unlockedStage / TOTAL_STAGES) * 100}%`;
  }

  function updateAnswerProgress() {
    const checked = el.quizForm.querySelectorAll('input[type="radio"]:checked').length;
    el.answerProgressText.textContent = `${checked} / ${QUESTIONS_PER_STAGE}`;
    el.questionCountPill.textContent = `${checked} / ${QUESTIONS_PER_STAGE}`;
    el.answerProgressBar.style.width = `${(checked / QUESTIONS_PER_STAGE) * 100}%`;
    el.submitBtn.disabled = state.stageQuestionSet.length === 0;
  }

  function escapeHTML(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function renderQuiz() {
    el.quizForm.innerHTML = "";
    el.quizTitle.textContent = `教圖下學期考試版｜第 ${state.currentStage} 關`;
    el.quizSubtitle.textContent = `本關共 ${QUESTIONS_PER_STAGE} 題，需達 70% 才能進入下一關。`;

    state.stageQuestionSet.forEach((q, index) => {
      const card = document.createElement("section");
      card.className = "question-card";

      const optionsHTML = q.options.map((op, i) => {
        const letter = ["A", "B", "C", "D"][i];
        return `
          <label class="option">
            <input type="radio" name="q_${index}" value="${i}">
            <span class="option-label">${letter}</span>
            <span>${escapeHTML(op)}</span>
          </label>
        `;
      }).join("");

      card.innerHTML = `
        <div class="question-card__head">
          <div class="question-no">第 ${index + 1} 題</div>
          <div class="question-text">${escapeHTML(q.question)}</div>
        </div>
        <div class="options">
          ${optionsHTML}
        </div>
      `;
      el.quizForm.appendChild(card);
    });

    el.quizForm.querySelectorAll('input[type="radio"]').forEach(input => {
      input.addEventListener("change", updateAnswerProgress);
    });

    updateAnswerProgress();
  }

  function buildResultSummary(correct, total, percent, passed) {
    return `
      <div class="result-summary__score">${correct} / ${total}（${percent}%）</div>
      <div class="result-summary__meta">
        <span>角色：${escapeHTML(state.playerName || "未設定")}</span>
        <span>關卡：第 ${passed ? Math.max(1, state.currentStage - 1) : state.currentStage} 關</span>
        <span>作答時間：${formatTime(state.timerSec)}</span>
      </div>
      <div class="${passed ? "result-summary__pass" : "result-summary__fail"}">
        ${passed ? "已達過關門檻，可挑戰下一關。" : "未達 70%，請重抽題目後再試一次。"}
      </div>
    `;
  }

  function renderWrongList(wrongs) {
    el.wrongList.innerHTML = "";

    if (!wrongs.length) {
      const ok = document.createElement("div");
      ok.className = "note-box";
      ok.textContent = "本關全對，沒有需要顯示的錯題解析。";
      el.wrongList.appendChild(ok);
      return;
    }

    wrongs.forEach((item, idx) => {
      const myLetter = item.userAnswer >= 0 ? ["A", "B", "C", "D"][item.userAnswer] : "未作答";
      const correctLetter = ["A", "B", "C", "D"][item.correctAnswer];

      const card = document.createElement("article");
      card.className = "wrong-card";
      card.innerHTML = `
        <div class="wrong-card__head">
          <div class="wrong-card__title">錯題 ${idx + 1}</div>
        </div>
        <div class="wrong-card__body">
          <div><strong>題目：</strong>${escapeHTML(item.question)}</div>
          <div class="explain-row">
            <span class="answer-chip answer-chip--mine">你的答案：${myLetter}${item.userAnswer >= 0 ? `．${escapeHTML(item.options[item.userAnswer] || "")}` : ""}</span>
            <span class="answer-chip answer-chip--correct">正確答案：${correctLetter}．${escapeHTML(item.options[item.correctAnswer] || "")}</span>
          </div>
          <div class="explain-row"><strong>解析：</strong>${escapeHTML(item.explanation)}</div>
        </div>
      `;
      el.wrongList.appendChild(card);
    });
  }

  function showBankError() {
    el.resultSummary.classList.remove("empty-state");
    el.resultSummary.innerHTML = `
      bank-jt-sem2.js 載入失敗或格式不正確。<br>
      請確認：<br>
      1. bank-jt-sem2.js 是否真的已上傳<br>
      2. script 路徑是否正確<br>
      3. 是否已加上版本號避免快取<br>
      4. console 是否有 SyntaxError<br>
      5. 檔案內是否有 <code>window.BANK_JT_SEM2</code>
    `;
  }

  function startCurrentStage() {
    if (!window.BANK_JT_SEM2 || !Array.isArray(window.BANK_JT_SEM2.questions)) {
      showBankError();
      return;
    }

    const name = el.playerName.value.trim();
    state.playerName = name;
    saveProgress();
    renderStatus();

    state.stageQuestionSet = pickQuestionsForStage(state.currentStage);

    if (!state.stageQuestionSet.length) {
      el.resultSummary.classList.remove("empty-state");
      el.resultSummary.textContent = "目前題庫沒有可用題目，請先確認 bank-jt-sem2.js 內容。";
      return;
    }

    renderQuiz();
    startTimer();

    el.resultSummary.className = "result-summary empty-state";
    el.resultSummary.textContent = "本關尚未交卷";
    el.wrongList.innerHTML = "";
  }

  function rerollCurrentStage() {
    startCurrentStage();
  }

  function collectAnswersAndSubmit() {
    if (!state.stageQuestionSet.length) return;

    stopTimer();

    const answers = state.stageQuestionSet.map((q, index) => {
      const checked = el.quizForm.querySelector(`input[name="q_${index}"]:checked`);
      return checked ? Number(checked.value) : -1;
    });

    let correct = 0;
    const wrongs = [];

    state.stageQuestionSet.forEach((q, index) => {
      const userAnswer = answers[index];
      if (userAnswer === q.answer) {
        correct += 1;
      } else {
        wrongs.push({
          question: q.question,
          options: q.options,
          userAnswer,
          correctAnswer: q.answer,
          explanation: q.explanation
        });
      }
    });

    const total = state.stageQuestionSet.length;
    const percent = Math.round((correct / total) * 100);
    const passed = percent >= PASS_PERCENT;

    const finishedStage = state.currentStage;

    if (passed && state.unlockedStage < TOTAL_STAGES && finishedStage === state.unlockedStage) {
      state.unlockedStage += 1;
    }

    if (passed && state.currentStage < TOTAL_STAGES) {
      state.currentStage += 1;
    }

    saveProgress();
    renderStageMap();
    renderStatus();

    el.resultSummary.classList.remove("empty-state");
    el.resultSummary.innerHTML = `
      <div class="result-summary__score">${correct} / ${total}（${percent}%）</div>
      <div class="result-summary__meta">
        <span>角色：${escapeHTML(state.playerName || "未設定")}</span>
        <span>關卡：第 ${finishedStage} 關</span>
        <span>作答時間：${formatTime(state.timerSec)}</span>
      </div>
      <div class="${passed ? "result-summary__pass" : "result-summary__fail"}">
        ${passed ? "已達過關門檻，可挑戰下一關。" : "未達 70%，請重抽題目後再試一次。"}
      </div>
    `;

    renderWrongList(wrongs);
    el.resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function init() {
    loadProgress();
    renderStageMap();
    renderStatus();
    updateAnswerProgress();

    el.playerName.addEventListener("input", () => {
      state.playerName = el.playerName.value.trim();
      el.playerNamePreview.textContent = state.playerName || "未設定";
      saveProgress();
    });

    el.startBtn.addEventListener("click", startCurrentStage);
    el.rerollBtn.addEventListener("click", rerollCurrentStage);
    el.submitBtn.addEventListener("click", collectAnswersAndSubmit);

    if (!window.BANK_JT_SEM2 || !Array.isArray(window.BANK_JT_SEM2.questions)) {
      showBankError();
    }
  }

  init();
})();
