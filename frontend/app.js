import { NeonRaceRenderer } from "./race.js";

const state = {
  raffles: [],
  activeTab: "admin",
  currentRace: null,
  config: {
    autoConfirmPayments: true,
    paymentMode: "mock",
  },
};

const elements = {
  tabs: [...document.querySelectorAll(".nav-btn")],
  panels: [...document.querySelectorAll(".tab-panel")],
  openTabButtons: [...document.querySelectorAll("[data-open-tab]")],
  adminForm: document.getElementById("admin-form"),
  adminResult: document.getElementById("admin-result"),
  participantRaffle: document.getElementById("participant-raffle"),
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
  wireParticipant();
  wireRace();
  race.renderIdle();
  await loadHealth();
  await refreshRaffles();
}

function initTelegram() {
  if (!window.Telegram?.WebApp) {
    return;
  }

  const webApp = window.Telegram.WebApp;
  webApp.ready();
  webApp.expand();

  const user = webApp.initDataUnsafe?.user;
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
  const drawAt = elements.adminForm.querySelector("[name='drawAt']");
  const nextHour = new Date(Date.now() + 60 * 60 * 1000);
  drawAt.value = new Date(nextHour.getTime() - nextHour.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  elements.adminForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const formData = new FormData(elements.adminForm);
      const payload = Object.fromEntries(formData.entries());
      payload.prizePool = Number(payload.prizePool);
      payload.winnersCount = Number(payload.winnersCount);
      payload.drawAt = new Date(payload.drawAt).toISOString();

      const created = await api("/api/raffles", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const paymentResult = await api(`/api/raffles/${created.raffle.id}/payment-intent`, {
        method: "POST",
      });

      renderAdminResult(paymentResult.raffle, paymentResult.payment);
      await refreshRaffles(created.raffle.id);
      setActiveTab("participant");
    } catch (error) {
      showError(elements.adminResult, error.message);
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

      elements.participantResult.classList.remove("hidden");
      elements.participantResult.innerHTML = `
        <strong>${escapeHtml(joined.participant.displayName)} участвует</strong>
        <small>Шанс: ${joined.participant.chancePercent}% | Инвайтов: ${joined.participant.invitesCount}</small>
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

async function refreshRaffles(selectId) {
  const response = await api("/api/raffles");
  state.raffles = response.raffles;
  populateSelect(elements.participantRaffle, state.raffles);
  populateSelect(elements.raceRaffle, state.raffles);
  updateHero();

  if (selectId) {
    elements.participantRaffle.value = selectId;
    elements.raceRaffle.value = selectId;
  }

  if (!elements.participantRaffle.value && state.raffles[0]) {
    elements.participantRaffle.value = state.raffles[0].id;
    elements.raceRaffle.value = state.raffles[0].id;
  }

  await refreshLeaderboard();
}

async function loadHealth() {
  const response = await api("/api/health");
  state.config = response.config || state.config;
}

async function refreshLeaderboard() {
  const raffleId = elements.participantRaffle.value;
  if (!raffleId) {
    elements.leaderboardList.innerHTML = `<div class="result-card">Сначала создай розыгрыш</div>`;
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
            <small>@${escapeHtml(player.username || "player")}</small>
          </div>
          <div>${player.invitesCount} инвайтов</div>
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
      "Розыгрыш ещё не завершён. Дождись времени итогов или нажми финализацию.";
    elements.winnersPanel.innerHTML = "";
    race.renderIdle();
    return;
  }

  const response = await api(`/api/raffles/${raffleId}/race`);
  state.currentRace = response.race;
  elements.raceTitle.textContent = `${raffle.title} • ${raffle.prizePerWinner} ${raffle.currency} каждому`;
  elements.raceMeta.textContent = `Победителей: ${raffle.winnersCount} | Участников: ${raffle.participantCount} | Инвайтов: ${raffle.inviteCount}`;
  renderWinners(raffle.winners || []);
  race.play(response.race);
}

function renderAdminResult(raffle, payment) {
  const isFunded = raffle.status === "funded";
  const statusText = isFunded ? "Розыгрыш оплачен" : "Счёт создан, ждём оплату";
  const helpText =
    payment.mode === "cryptopay"
      ? "Открой ссылку на инвойс и оплати счёт в CryptoBot. После webhook розыгрыш перейдёт в funded."
      : "Это mock-режим. Оплата подтверждается локально для демо-сценария.";

  elements.adminResult.classList.remove("hidden");
  elements.adminResult.innerHTML = `
    <strong>${statusText}</strong>
    <small>${escapeHtml(raffle.title)} • ${raffle.prizePool} ${raffle.currency} • ${raffle.winnersCount} победителей</small>
    <code>${escapeHtml(raffle.publicLink)}</code>
    <code>${escapeHtml(payment.invoiceUrl || "")}</code>
    <small>${escapeHtml(helpText)}</small>
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

      return `
        <div class="winner-card">
          <div class="winner-place">#${winner.place}</div>
          <div>
            <strong>${escapeHtml(winner.displayName)}</strong>
            <small>${winner.prize} ${escapeHtml(winner.payout?.asset || "USDT")} • payout: ${escapeHtml(payoutStatus)} • msg: ${escapeHtml(notificationStatus)}</small>
          </div>
          <div>Winner</div>
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
    throw new Error(data.message || data.error || "request_failed");
  }
  return data;
}

function showError(container, message) {
  container.classList.remove("hidden");
  container.innerHTML = `<strong>Ошибка</strong><small>${escapeHtml(message)}</small>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
