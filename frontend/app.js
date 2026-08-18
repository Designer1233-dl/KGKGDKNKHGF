const state = {
  raffles: [],
  selectedRaffleId: "",
  selectedCaptchaAnswer: "",
  auth: {
    telegramUserId: "",
    initData: "",
    isAdmin: false,
    photoUrl: "",
    username: "",
    displayName: "",
  },
  config: {
    appName: "Green Raffle",
  },
};

const elements = {
  body: document.body,
  adminSection: document.getElementById("admin-section"),
  adminForm: document.getElementById("admin-form"),
  adminResult: document.getElementById("admin-result"),
  channelSelect: document.getElementById("channel-select"),
  playerTitle: document.getElementById("player-title"),
  playerSubtitle: document.getElementById("player-subtitle"),
  raffleState: document.getElementById("raffle-state"),
  captchaPrompt: document.getElementById("captcha-prompt"),
  captchaOptions: document.getElementById("captcha-options"),
  joinButton: document.getElementById("join-button"),
  playerResult: document.getElementById("player-result"),
  activeRaffles: document.getElementById("active-raffles"),
  winnersFeed: document.getElementById("winners-feed"),
  finalizeList: document.getElementById("finalize-list"),
  playerName: document.getElementById("player-name"),
  playerUsername: document.getElementById("player-username"),
  playerTelegramId: document.getElementById("player-telegram-id"),
};

boot();

async function boot() {
  initTelegram();
  wireAdminForm();
  wireJoin();
  await loadHealth();
  await refreshRaffles();
}

function initTelegram() {
  state.auth.initData = window.Telegram?.WebApp?.initData || "";

  if (!window.Telegram?.WebApp) {
    return;
  }

  const webApp = window.Telegram.WebApp;
  webApp.ready();
  webApp.expand();

  const user = webApp.initDataUnsafe?.user;
  if (!user) {
    return;
  }

  state.auth.telegramUserId = String(user.id || "");
  state.auth.photoUrl = user.photo_url || user.photoUrl || "";
  state.auth.username = user.username || "";
  state.auth.displayName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();

  elements.playerTelegramId.value = state.auth.telegramUserId;
  elements.playerUsername.value = state.auth.username;
  elements.playerName.value = state.auth.displayName || state.auth.username || "Игрок";
}

async function loadHealth() {
  const response = await api("/api/health");
  state.config = response.config || state.config;
  state.auth.isAdmin = Boolean(response.viewer?.isAdmin);
  elements.body.classList.toggle("admin-mode", state.auth.isAdmin);
  elements.body.classList.toggle("viewer-mode", !state.auth.isAdmin);
  elements.adminSection.hidden = !state.auth.isAdmin;
  renderChannelOptions();
}

function renderChannelOptions() {
  if (!elements.channelSelect) {
    return;
  }

  const channels = Array.isArray(state.config.publishChannels) ? state.config.publishChannels : [];
  const baseOption = `<option value="">${channels.length ? "Выбери канал для публикации" : "Нет доступных каналов"}</option>`;
  const items = channels
    .map((channel) => `<option value="${escapeHtml(channel)}">${escapeHtml(channel)}</option>`)
    .join("");

  elements.channelSelect.innerHTML = baseOption + items;
  elements.channelSelect.disabled = channels.length === 0;
}

async function refreshRaffles() {
  const response = await api("/api/raffles");
  state.raffles = Array.isArray(response.raffles) ? response.raffles : [];
  chooseCurrentRaffle();
  renderPlayerCard();
  renderActiveRaffles();
  renderFinalizeList();
  renderWinnersFeed();
}

function chooseCurrentRaffle() {
  const startSlug = extractRaffleSlug();
  const activeRaffles = state.raffles.filter((raffle) => raffle.status === "funded");
  const byStartParam = activeRaffles.find((raffle) => raffle.slug === startSlug);
  const existing = activeRaffles.find((raffle) => raffle.id === state.selectedRaffleId);
  const next = byStartParam || existing || activeRaffles[0] || null;

  state.selectedRaffleId = next ? next.id : "";
  state.selectedCaptchaAnswer = "";
}

function renderPlayerCard() {
  const raffle = getSelectedRaffle();
  const totalActive = state.raffles.filter((item) => item.status === "funded").length;

  if (!raffle) {
    elements.playerTitle.textContent = "Активных розыгрышей нет";
    elements.playerSubtitle.textContent = "Как только админ опубликует новый конкурс, он появится здесь.";
    elements.raffleState.innerHTML = `<div class="status-card muted">К сожалению, сейчас нет активного конкурса.</div>`;
    elements.captchaPrompt.textContent = "Капча появится, когда откроется розыгрыш.";
    elements.captchaOptions.innerHTML = "";
    elements.joinButton.disabled = true;
    return;
  }

  elements.playerTitle.textContent = raffle.title;
  elements.playerSubtitle.textContent = raffle.description || "Нажми нужный фрукт, пройди капчу и участвуй.";
  elements.raffleState.innerHTML = `
    <div class="status-card">
      <strong>Приз: ${escapeHtml(formatPrize(raffle))}</strong>
      <span>Победителей: ${raffle.winnersCount}</span>
      <span>Участников: ${raffle.participantCount}</span>
      <span>Активных конкурсов: ${totalActive}</span>
    </div>
  `;
  elements.captchaPrompt.textContent = raffle.captcha?.prompt || "Подтверди участие";
  renderCaptchaOptions(raffle.captcha?.options || []);
  elements.joinButton.disabled = false;
}

function renderCaptchaOptions(options) {
  if (!options.length) {
    elements.captchaOptions.innerHTML = "";
    return;
  }

  elements.captchaOptions.innerHTML = options
    .map(
      (option) => `
        <button
          class="captcha-option${state.selectedCaptchaAnswer === option.id ? " active" : ""}"
          type="button"
          data-captcha-answer="${escapeHtml(option.id)}"
        >
          <span class="emoji">${escapeHtml(option.emoji || "")}</span>
          <span>${escapeHtml(option.label)}</span>
        </button>
      `
    )
    .join("");

  for (const button of elements.captchaOptions.querySelectorAll("[data-captcha-answer]")) {
    button.addEventListener("click", () => {
      state.selectedCaptchaAnswer = button.dataset.captchaAnswer || "";
      renderCaptchaOptions(options);
    });
  }
}

function renderActiveRaffles() {
  const activeRaffles = state.raffles.filter((raffle) => raffle.status === "funded");
  if (!activeRaffles.length) {
    elements.activeRaffles.innerHTML = `<div class="mini-card">Новых активных розыгрышей пока нет.</div>`;
    return;
  }

  elements.activeRaffles.innerHTML = activeRaffles
    .map(
      (raffle) => `
        <button class="raffle-chip${raffle.id === state.selectedRaffleId ? " active" : ""}" type="button" data-select-raffle="${raffle.id}">
          <strong>${escapeHtml(raffle.title)}</strong>
          <span>${escapeHtml(formatPrize(raffle))}</span>
        </button>
      `
    )
    .join("");

  for (const button of elements.activeRaffles.querySelectorAll("[data-select-raffle]")) {
    button.addEventListener("click", () => {
      state.selectedRaffleId = button.dataset.selectRaffle || "";
      state.selectedCaptchaAnswer = "";
      renderPlayerCard();
      renderActiveRaffles();
      elements.playerResult.classList.add("hidden");
    });
  }
}

function renderFinalizeList() {
  if (!state.auth.isAdmin) {
    elements.finalizeList.innerHTML = "";
    return;
  }

  const activeRaffles = state.raffles.filter((raffle) => raffle.status === "funded");
  if (!activeRaffles.length) {
    elements.finalizeList.innerHTML = `<div class="mini-card">Активных конкурсов для завершения нет.</div>`;
    return;
  }

  elements.finalizeList.innerHTML = activeRaffles
    .map(
      (raffle) => `
        <div class="admin-raffle-row">
          <div>
            <strong>${escapeHtml(raffle.title)}</strong>
            <small>${escapeHtml(formatPrize(raffle))} | Участников: ${raffle.participantCount}</small>
          </div>
          <button class="secondary" type="button" data-finalize-raffle="${raffle.id}">Завершить конкурс</button>
        </div>
      `
    )
    .join("");

  for (const button of elements.finalizeList.querySelectorAll("[data-finalize-raffle]")) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api(`/api/raffles/${button.dataset.finalizeRaffle}/finalize?force=1`, {
          method: "POST",
        });
        await refreshRaffles();
        showMessage(elements.adminResult, "Конкурс завершён. Победители добавлены в пост.");
      } catch (error) {
        showError(elements.adminResult, formatApiError(error.message));
      } finally {
        button.disabled = false;
      }
    });
  }
}

function renderWinnersFeed() {
  const completed = state.raffles.filter((raffle) => raffle.status === "completed").slice(0, 6);
  if (!completed.length) {
    elements.winnersFeed.innerHTML = `<div class="mini-card">Здесь появятся победители завершённых розыгрышей.</div>`;
    return;
  }

  elements.winnersFeed.innerHTML = completed
    .map((raffle) => {
      const winners = raffle.winners?.length
        ? raffle.winners
            .map((winner) => `<li>${winner.place}. ${escapeHtml(winner.displayName)} - ${winner.prize} ${escapeHtml(raffle.currency)}</li>`)
            .join("")
        : "<li>Победителей пока нет</li>";

      return `
        <article class="winner-card">
          <strong>${escapeHtml(raffle.title)}</strong>
          <small>${escapeHtml(formatPrize(raffle))}</small>
          <ul>${winners}</ul>
        </article>
      `;
    })
    .join("");
}

function wireAdminForm() {
  elements.adminForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(elements.adminForm);
    const durationMinutes = Number(form.get("durationMinutes") || 60);
    const payload = {
      title: String(form.get("title") || "").trim(),
      postText: String(form.get("postText") || "").trim(),
      prizePool: Number(form.get("prizePool") || 0),
      currency: String(form.get("currency") || "USDT").trim() || "USDT",
      winnersCount: Number(form.get("winnersCount") || 1),
      channel: String(form.get("channel") || "").trim(),
      drawAt: new Date(Date.now() + durationMinutes * 60 * 1000).toISOString(),
    };

    try {
      const created = await api("/api/raffles", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      elements.adminForm.reset();
      showMessage(
        elements.adminResult,
        `Конкурс создан. ${created.raffle.channelPost?.url ? `Пост: ${created.raffle.channelPost.url}` : "Если канал подключён, пост уже опубликован."}`
      );
      await refreshRaffles();
    } catch (error) {
      showError(elements.adminResult, formatApiError(error.message));
    }
  });
}

function wireJoin() {
  elements.joinButton.addEventListener("click", async () => {
    const raffle = getSelectedRaffle();
    if (!raffle) {
      showError(elements.playerResult, "Сейчас нет активного конкурса.");
      return;
    }

    if (!state.selectedCaptchaAnswer) {
      showError(elements.playerResult, "Сначала пройди капчу.");
      return;
    }

    const payload = {
      telegramId: elements.playerTelegramId.value.trim(),
      username: elements.playerUsername.value.trim(),
      displayName: elements.playerName.value.trim(),
      photoUrl: state.auth.photoUrl,
      captchaAnswer: state.selectedCaptchaAnswer,
    };

    try {
      const joined = await api(`/api/raffles/${raffle.id}/join`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      showMessage(
        elements.playerResult,
        `${joined.participant.displayName} участвует. Твой шанс сейчас ${joined.participant.chancePercent}%.`
      );
      await refreshRaffles();
    } catch (error) {
      showError(elements.playerResult, formatApiError(error.message));
    }
  });
}

function getSelectedRaffle() {
  return state.raffles.find((raffle) => raffle.id === state.selectedRaffleId) || null;
}

function extractRaffleSlug() {
  const params = new URLSearchParams(window.location.search);
  const startParam =
    window.Telegram?.WebApp?.initDataUnsafe?.start_param ||
    params.get("startapp") ||
    params.get("tgWebAppStartParam") ||
    "";

  if (!String(startParam).startsWith("raffle_")) {
    return "";
  }

  return String(startParam).slice("raffle_".length);
}

function formatPrize(raffle) {
  return `${raffle.prizePool} ${raffle.currency}`;
}

function formatApiError(message) {
  switch (message) {
    case "captcha_failed":
      return "Капча не пройдена. Выбери правильный фрукт.";
    case "telegramId and displayName are required":
      return "Открой приложение из Telegram, чтобы вступить в конкурс.";
    default:
      return message || "Произошла ошибка";
  }
}

function showMessage(element, text) {
  element.classList.remove("hidden", "error");
  element.textContent = text;
}

function showError(element, text) {
  element.classList.remove("hidden");
  element.classList.add("error");
  element.textContent = text;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(state.auth.telegramUserId ? { "X-Telegram-User-Id": state.auth.telegramUserId } : {}),
      ...(state.auth.initData ? { "X-Telegram-Init-Data": state.auth.initData } : {}),
      ...(options.headers || {}),
    },
    body: options.body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || "request_failed");
  }

  return payload;
}
