import { NeonRaceRenderer } from "./race.js";

const state = {
  raffles: [],
  activeTab: "admin",
  currentRace: null,
  entryStartParam: "",
  config: {
    autoConfirmPayments: true,
    paymentMode: "mock",
  },
  paymentPollTimer: null,
  paymentPollRaffleId: null,
};

const elements = {
  tabs: [...document.querySelectorAll(".nav-btn")],
  panels: [...document.querySelectorAll(".tab-panel")],
  openTabButtons: [...document.querySelectorAll("[data-open-tab]")],
  adminForm: document.getElementById("admin-form"),
  adminResult: document.getElementById("admin-result"),
  durationMinutes: document.getElementById("duration-minutes"),
  drawPreview: document.getElementById("draw-preview"),
  testAdminForm: document.getElementById("test-admin-form"),
  testAdminResult: document.getElementById("test-admin-result"),
  testDurationMinutes: document.getElementById("test-duration-minutes"),
  testDrawPreview: document.getElementById("test-draw-preview"),
  participantRaffle: document.getElementById("participant-raffle"),
  participantEmptyState: document.getElementById("participant-empty-state"),
  raceRaffle: document.getElementById("race-raffle"),
  joinButton: document.getElementById("join-button"),
  participantResult: document.getElementById("participant-result"),
  participantTelegramId: document.getElementById("participant-telegram-id"),
  participantUsername: document.getElementById("participant-username"),
  participantDisplayName: document.getElementById("participant-display-name"),
  participantRefCode: document.getElementById("participant-ref-code"),
  refreshBoard: document.getElementById("refresh-board"),
  leaderboardList: document.getElementById("leaderboard-list"),
  loadRace: document.getElementById("load-race"),
  finalizeButton: document.getElementById("finalize-button"),
  winnersPanel: document.getElementById("winners-panel"),
  raceTitle: document.getElementById("race-title"),
  raceMeta: document.getElementById("race-meta"),
  heroPool: document.getElementById("hero-pool"),
  heroRaffles: document.getElementById("hero-raffles"),
  heroPlayers: document.getElementById("hero-players"),
  heroInvites: document.getElementById("hero-invites"),
};

const race = new NeonRaceRenderer(document.getElementById("race-canvas"));

boot();

async function boot() {
  initTelegram();
  wireTabs();
  wireAdmin();
  wireTestAdmin();
  wireParticipant();
  wireRace();
  race.renderIdle();
  await loadHealth();
  await refreshRaffles();
}

function initTelegram() {
  state.entryStartParam = readStartParam();

  if (!window.Telegram?.WebApp) {
    return;
  }

  const webApp = window.Telegram.WebApp;
  webApp.ready();
  webApp.expand();

  const user = webApp.initDataUnsafe?.user;
  const telegramStartParam = webApp.initDataUnsafe?.start_param;
  if (telegramStartParam) {
    state.entryStartParam = telegramStartParam;
  }

  if (user) {
    elements.participantTelegramId.value = String(user.id || "");
    elements.participantUsername.value = user.username || "";
    elements.participantDisplayName.value = [user.first_name, user.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
  }
}

function wireTabs() {
  for (const button of elements.tabs) {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  }

  for (const button of elements.openTabButtons) {
    button.addEventListener("click", () => setActiveTab(button.dataset.openTab));
  }
}

function wireAdmin() {
  populateDurationOptions(elements.durationMinutes);
  updateDrawPreview(elements.durationMinutes, elements.drawPreview);
  elements.durationMinutes.addEventListener("change", () => {
    updateDrawPreview(elements.durationMinutes, elements.drawPreview);
  });

  elements.adminForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const formData = new FormData(elements.adminForm);
      const payload = Object.fromEntries(formData.entries());
      payload.prizePool = Number(payload.prizePool);
      payload.winnersCount = Number(payload.winnersCount);
      payload.durationMinutes = Number(payload.durationMinutes);
      payload.drawAt = new Date(Date.now() + payload.durationMinutes * 60 * 1000).toISOString();

      const created = await api("/api/raffles", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const paymentResult = await api(`/api/raffles/${created.raffle.id}/payment-intent`, {
        method: "POST",
      });

      renderAdminResult(paymentResult.raffle, paymentResult.payment);
      await refreshRaffles(created.raffle.id);
      startPaymentPolling(created.raffle.id);
    } catch (error) {
      showError(elements.adminResult, error.message);
    }
  });
}

function wireTestAdmin() {
  populateDurationOptions(elements.testDurationMinutes);
  updateDrawPreview(elements.testDurationMinutes, elements.testDrawPreview, true);
  elements.testDurationMinutes.addEventListener("change", () => {
    updateDrawPreview(elements.testDurationMinutes, elements.testDrawPreview, true);
  });

  elements.testAdminForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const formData = new FormData(elements.testAdminForm);
      const payload = Object.fromEntries(formData.entries());
      payload.prizePool = Number(payload.prizePool);
      payload.winnersCount = Number(payload.winnersCount);
      payload.durationMinutes = Number(payload.durationMinutes);
      payload.drawAt = new Date(Date.now() + payload.durationMinutes * 60 * 1000).toISOString();

      const created = await api("/api/raffles", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const paymentResult = await api(`/api/raffles/${created.raffle.id}/test-fund`, {
        method: "POST",
      });

      renderTestAdminResult(paymentResult.raffle, paymentResult.payment);
      await refreshRaffles(created.raffle.id);
      setActiveTab("participant");
    } catch (error) {
      showError(elements.testAdminResult, error.message);
    }
  });
}

function wireParticipant() {
  elements.joinButton.addEventListener("click", async () => {
    const raffleId = elements.participantRaffle.value;
    if (!raffleId) {
      return;
    }

    try {
      const payload = {
        telegramId: elements.participantTelegramId.value.trim(),
        username: elements.participantUsername.value.trim(),
        displayName: elements.participantDisplayName.value.trim(),
        ref: elements.participantRefCode.value.trim(),
      };

      const joined = await api(`/api/raffles/${raffleId}/join`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const usernameLine = joined.participant.username
        ? `@${joined.participant.username}`
        : joined.participant.displayName;

      elements.participantResult.classList.remove("hidden");
      elements.participantResult.innerHTML = `
        <strong>${escapeHtml(joined.participant.displayName)} участвует</strong>
        <small>${escapeHtml(usernameLine)} | Шанс: ${joined.participant.chancePercent}% | Приглашено: ${joined.participant.invitesCount}</small>
        <small>Твоя реферальная ссылка. Каждое приглашение даёт +10 к шансу.</small>
        <code>${escapeHtml(joined.referralLink)}</code>
      `;

      elements.participantRefCode.value = joined.participant.refCode;
      await refreshRaffles(raffleId);
      await refreshLeaderboard();
    } catch (error) {
      showError(elements.participantResult, error.message);
    }
  });

  elements.refreshBoard.addEventListener("click", refreshLeaderboard);
}

function wireRace() {
  elements.loadRace.addEventListener("click", async () => {
    const raffleId = elements.raceRaffle.value;
    if (!raffleId) {
      return;
    }

    try {
      await loadRace(raffleId);
    } catch (error) {
      elements.raceMeta.textContent = error.message;
    }
  });

  elements.finalizeButton.addEventListener("click", async () => {
    const raffleId = elements.raceRaffle.value;
    if (!raffleId) {
      return;
    }

    try {
      await api(`/api/raffles/${raffleId}/finalize?force=1`, {
        method: "POST",
      });
      await refreshRaffles(raffleId);
      await loadRace(raffleId);
    } catch (error) {
      elements.raceMeta.textContent = error.message;
    }
  });
}

function populateDurationOptions(selectElement) {
  selectElement.innerHTML = Array.from({ length: 30 }, (_, index) => {
    const minutes = index + 1;
    const label = formatMinutes(minutes);
    return `<option value="${minutes}">${label}</option>`;
  }).join("");
  selectElement.value = "5";
}

function updateDrawPreview(selectElement, previewElement, isTest = false) {
  const durationMinutes = Number(selectElement.value || 5);
  const finishAt = new Date(Date.now() + durationMinutes * 60 * 1000);
  previewElement.innerHTML = `
    <strong>Длительность: ${formatMinutes(durationMinutes)}</strong>
    <small>${isTest ? "Тестовый" : "Розыгрыш"} завершится автоматически через ${formatMinutes(durationMinutes)} от текущего времени устройства.</small>
    <small>Ожидаемое время окончания: ${formatLocalDateTime(finishAt)}</small>
  `;
}

async function refreshRaffles(selectId) {
  const response = await api("/api/raffles");
  state.raffles = response.raffles;
  populateSelect(elements.participantRaffle, state.raffles);
  populateSelect(elements.raceRaffle, state.raffles);
  updateHero();

  const entryRaffle = findEntryRaffle();
  const hasEntryRaffle = Boolean(entryRaffle);
  const openedFromRaffleLink = Boolean(state.entryStartParam);
  const shouldLockParticipantFlow = !hasEntryRaffle && !openedFromRaffleLink;

  if (selectId) {
    elements.participantRaffle.value = selectId;
    elements.raceRaffle.value = selectId;
  } else if (entryRaffle) {
    elements.participantRaffle.value = entryRaffle.id;
    elements.raceRaffle.value = entryRaffle.id;
  }

  if (!elements.participantRaffle.value && state.raffles[0]) {
    elements.participantRaffle.value = state.raffles[0].id;
    elements.raceRaffle.value = state.raffles[0].id;
  }

  applyParticipantAccessState({
    locked: shouldLockParticipantFlow,
    message: "нету активных розыгрышей",
  });

  await refreshLeaderboard();
}

async function loadHealth() {
  const response = await api("/api/health");
  state.config = response.config || state.config;
}

async function refreshLeaderboard() {
  if (!elements.participantEmptyState.classList.contains("hidden")) {
    elements.leaderboardList.innerHTML = "";
    return;
  }

  const raffleId = elements.participantRaffle.value;
  if (!raffleId) {
    elements.leaderboardList.innerHTML = `<div class="result-card">Сначала создай и оплати розыгрыш</div>`;
    return;
  }

  const board = await api(`/api/raffles/${raffleId}/leaderboard`);
  if (!board.leaderboard.length) {
    elements.leaderboardList.innerHTML = `<div class="result-card">Пока нет участников</div>`;
    return;
  }

  elements.leaderboardList.innerHTML = board.leaderboard
    .map(
      (player, index) => `
        <div class="leaderboard-row">
          <div class="leaderboard-rank">${index + 1}</div>
          <div class="leaderboard-name">
            <strong>${escapeHtml(player.displayName)}</strong>
            <small>${escapeHtml(player.usernameLabel)}</small>
          </div>
          <div>${player.invitesCount} инвайтов</div>
          <div>+${player.referralBonus} к шансу</div>
          <div>${player.chancePercent}% шанс</div>
        </div>
      `
    )
    .join("");
}

async function loadRace(raffleId) {
  const raffle = state.raffles.find((item) => item.id === raffleId);
  if (!raffle) {
    return;
  }

  if (raffle.status !== "completed") {
    elements.raceTitle.textContent = raffle.title;
    elements.raceMeta.textContent =
      "Розыгрыш еще не завершен. Дождись времени итогов или нажми финализацию.";
    elements.winnersPanel.innerHTML = "";
    race.renderIdle();
    return;
  }

  const response = await api(`/api/raffles/${raffleId}/race`);
  state.currentRace = response.race;
  elements.raceTitle.textContent = `${raffle.title} • ${raffle.prizePerWinner} ${raffle.currency} каждому`;
  elements.raceMeta.textContent =
    `Победителей: ${raffle.winnersCount} | Участников: ${raffle.participantCount} | Инвайтов: ${raffle.inviteCount}`;
  renderWinners(raffle.winners || []);
  race.play(response.race);
}

function renderAdminResult(raffle, payment) {
  const isFunded = raffle.status === "funded" || raffle.status === "completed";
  const paymentLink = payment?.invoiceUrl || raffle.paymentLink || raffle.crypto?.invoiceUrl || "";
  const shareBlock = isFunded
    ? `
      <small>Оплата подтверждена. Теперь можешь отправлять пользователям ссылку на розыгрыш.</small>
      <code>${escapeHtml(raffle.publicLink)}</code>
    `
    : `
      <small>Сначала оплати счёт. Ссылка на розыгрыш появится после подтверждения оплаты.</small>
    `;

  elements.adminResult.classList.remove("hidden");
  elements.adminResult.innerHTML = `
    <strong>${isFunded ? "Розыгрыш готов к участникам" : "Сначала оплата розыгрыша"}</strong>
    <small>${escapeHtml(raffle.title)} • Сумма: ${raffle.prizePool} ${raffle.currency} • Победителей: ${raffle.winnersCount}</small>
    <small>Шаг 1: оплати счёт по ссылке ниже.</small>
    <code>${escapeHtml(paymentLink)}</code>
    <small>Шаг 2: после оплаты пользователи смогут заходить по ссылке розыгрыша и получать свою реферальную ссылку.</small>
    ${shareBlock}
  `;
}

function renderTestAdminResult(raffle) {
  elements.testAdminResult.classList.remove("hidden");
  elements.testAdminResult.innerHTML = `
    <strong>Тестовый розыгрыш сразу активирован</strong>
    <small>${escapeHtml(raffle.title)} • Сумма: ${raffle.prizePool} ${raffle.currency} • Победителей: ${raffle.winnersCount}</small>
    <small>CryptoBot не нужен. Можешь сразу отправлять ссылку участникам.</small>
    <code>${escapeHtml(raffle.publicLink)}</code>
  `;
}

function renderWinners(winners) {
  if (!winners.length) {
    elements.winnersPanel.innerHTML = "";
    return;
  }

  elements.winnersPanel.innerHTML = winners
    .map((winner) => {
      const payoutStatus = winner.payout?.status || "pending";
      const notificationStatus = winner.notification?.status || "pending";
      const usernameLabel = winner.username ? `@${winner.username}` : winner.displayName;

      return `
        <div class="winner-card">
          <div class="winner-place">#${winner.place}</div>
          <div>
            <strong>${escapeHtml(winner.displayName)}</strong>
            <small>${escapeHtml(usernameLabel)} • ${winner.prize} ${escapeHtml(winner.payout?.asset || "USDT")}</small>
            <small>payout: ${escapeHtml(payoutStatus)} • msg: ${escapeHtml(notificationStatus)}</small>
          </div>
          <div>WIN</div>
        </div>
      `;
    })
    .join("");
}

function populateSelect(select, raffles) {
  const current = select.value;
  select.innerHTML = raffles
    .map(
      (raffle) => `
        <option value="${raffle.id}">
          ${escapeHtml(raffle.title)} • ${raffle.status} • ${raffle.prizePool} ${raffle.currency}
        </option>
      `
    )
    .join("");

  if (raffles.some((item) => item.id === current)) {
    select.value = current;
  }
}

function updateHero() {
  const totalPool = state.raffles.reduce((sum, item) => sum + item.prizePool, 0);
  const totalPlayers = state.raffles.reduce((sum, item) => sum + item.participantCount, 0);
  const totalInvites = state.raffles.reduce((sum, item) => sum + item.inviteCount, 0);

  elements.heroPool.textContent = `${totalPool} USDT`;
  elements.heroRaffles.textContent = String(state.raffles.length);
  elements.heroPlayers.textContent = String(totalPlayers);
  elements.heroInvites.textContent = String(totalInvites);
}

function setActiveTab(tab) {
  state.activeTab = tab;
  for (const button of elements.tabs) {
    button.classList.toggle("active", button.dataset.tab === tab);
  }
  for (const panel of elements.panels) {
    panel.classList.toggle("active", panel.dataset.panel === tab);
  }
}

function startPaymentPolling(raffleId) {
  stopPaymentPolling();
  state.paymentPollRaffleId = raffleId;

  state.paymentPollTimer = setInterval(async () => {
    try {
      const response = await api(`/api/raffles/${raffleId}`);
      const raffle = response.raffle;
      const activePayment = raffle.paymentLink
        ? { invoiceUrl: raffle.paymentLink }
        : { invoiceUrl: raffle.crypto?.invoiceUrl || "" };

      renderAdminResult(raffle, activePayment);
      await refreshRaffles(raffleId);

      if (raffle.status === "funded" || raffle.status === "completed") {
        stopPaymentPolling();
      }
    } catch (error) {
      console.error("payment polling failed", error);
    }
  }, 4000);
}

function stopPaymentPolling() {
  if (state.paymentPollTimer) {
    clearInterval(state.paymentPollTimer);
    state.paymentPollTimer = null;
  }
  state.paymentPollRaffleId = null;
}

function applyParticipantAccessState({ locked, message }) {
  elements.participantEmptyState.classList.toggle("hidden", !locked);
  elements.participantRaffle.disabled = locked;
  elements.joinButton.disabled = locked;
  elements.participantTelegramId.disabled = locked;
  elements.participantUsername.disabled = locked;
  elements.participantDisplayName.disabled = locked;
  elements.participantRefCode.disabled = locked;

  if (locked) {
    elements.participantEmptyState.textContent = message;
    elements.participantResult.classList.add("hidden");
  }
}

function findEntryRaffle() {
  const raffleSlug = extractRaffleSlug(state.entryStartParam);
  if (!raffleSlug) {
    return null;
  }

  return (
    state.raffles.find((raffle) => raffle.slug === raffleSlug) ||
    state.raffles.find((raffle) => raffle.publicLink && raffle.publicLink.includes(`raffle_${raffleSlug}`)) ||
    null
  );
}

function extractRaffleSlug(startParam) {
  const value = String(startParam || "").trim();
  if (!value.startsWith("raffle_")) {
    return "";
  }
  return value.slice("raffle_".length);
}

function readStartParam() {
  const params = new URLSearchParams(window.location.search);
  return params.get("startapp") || params.get("tgWebAppStartParam") || "";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(extractErrorMessage(data));
  }

  return data;
}

function showError(container, message) {
  container.classList.remove("hidden");
  container.innerHTML = `<strong>Ошибка</strong><small>${escapeHtml(message)}</small>`;
}

function formatLocalDateTime(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMinutes(minutes) {
  const mod10 = minutes % 10;
  const mod100 = minutes % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${minutes} минута`;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${minutes} минуты`;
  }
  return `${minutes} минут`;
}

function extractErrorMessage(data) {
  if (!data) {
    return "request_failed";
  }

  const candidates = [data.message, data.error, data.detail];
  for (const candidate of candidates) {
    const normalized = normalizeErrorValue(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return "request_failed";
}

function normalizeErrorValue(value) {
  if (value == null || value === "") {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeErrorValue).filter(Boolean).join(", ");
  }

  if (typeof value === "object") {
    if (typeof value.message === "string") {
      return value.message;
    }

    const parts = Object.values(value).map(normalizeErrorValue).filter(Boolean);
    if (parts.length) {
      return parts.join(", ");
    }
  }

  return String(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
