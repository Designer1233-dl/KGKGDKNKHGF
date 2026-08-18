import { NeonRaceRenderer } from "./race.js";

const state = {
  raffles: [],
  activeTab: "participant",
  currentRace: null,
  entryStartParam: "",
  auth: {
    telegramUserId: "",
    initData: "",
    isAdmin: false,
    photoUrl: "",
  },
  config: {
    autoConfirmPayments: true,
    paymentMode: "mock",
  },
  paymentPollTimer: null,
  paymentPollRaffleId: null,
  raceResultsTimer: null,
};

const elements = {
  body: document.body,
  tabs: [...document.querySelectorAll(".nav-btn")],
  panels: [...document.querySelectorAll(".tab-panel")],
  openTabButtons: [...document.querySelectorAll("[data-open-tab]")],
  adminOnly: [...document.querySelectorAll("[data-admin-only]")],
  clearActiveRaffles: document.getElementById("clear-active-raffles"),
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
  participantResult: document.getElementById("participant-result"),
  claimPrizePanel: document.getElementById("claim-prize-panel"),
  participantTelegramId: document.getElementById("participant-telegram-id"),
  participantUsername: document.getElementById("participant-username"),
  participantDisplayName: document.getElementById("participant-display-name"),
  joinButton: document.getElementById("join-button"),
  refreshBoard: document.getElementById("refresh-board"),
  leaderboardList: document.getElementById("leaderboard-list"),
  raceRaffle: document.getElementById("race-raffle"),
  loadRace: document.getElementById("load-race"),
  fullscreenRace: document.getElementById("fullscreen-race"),
  finalizeButton: document.getElementById("finalize-button"),
  raceStage: document.getElementById("race-stage"),
  raceResultsOverlay: document.getElementById("race-results-overlay"),
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
  wireLinkActions();
  wireRace();
  wireFullscreenState();
  race.renderIdle();
  await loadHealth();
  await refreshRaffles();
}

function initTelegram() {
  state.entryStartParam = readStartParam();
  state.auth.initData = window.Telegram?.WebApp?.initData || "";

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
    state.auth.telegramUserId = String(user.id || "");
    state.auth.photoUrl = user.photo_url || user.photoUrl || "";
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
    button.addEventListener("click", () => {
      if (!canOpenTab(button.dataset.tab)) {
        return;
      }
      setActiveTab(button.dataset.tab);
    });
  }

  for (const button of elements.openTabButtons) {
    button.addEventListener("click", () => {
      if (!canOpenTab(button.dataset.openTab)) {
        return;
      }
      setActiveTab(button.dataset.openTab);
    });
  }
}

function wireAdmin() {
  populateDurationOptions(elements.durationMinutes);
  updateDrawPreview(elements.durationMinutes, elements.drawPreview, false);
  elements.durationMinutes.addEventListener("change", () => {
    updateDrawPreview(elements.durationMinutes, elements.drawPreview, false);
  });

  elements.adminForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const payload = rafflePayloadFromForm(elements.adminForm);
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

  elements.clearActiveRaffles.addEventListener("click", async () => {
    if (!window.confirm("Очистить все активные розыгрыши?")) {
      return;
    }

    try {
      const result = await api("/api/raffles/clear-active", {
        method: "POST",
      });
      stopPaymentPolling();
      clearRaceResultsOverlay();
      race.renderIdle();
      elements.adminResult.classList.remove("hidden");
      elements.adminResult.innerHTML = `
        <strong>Активные розыгрыши очищены</strong>
        <small>Удалено розыгрышей: ${result.removedCount}</small>
      `;
      await refreshRaffles();
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
      const payload = rafflePayloadFromForm(elements.testAdminForm);
      const created = await api("/api/raffles", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const paymentResult = await api(`/api/raffles/${created.raffle.id}/test-fund`, {
        method: "POST",
      });

      renderTestAdminResult(paymentResult.raffle);
      await refreshRaffles(created.raffle.id);
      setActiveTab("participant");
    } catch (error) {
      showError(elements.testAdminResult, error.message);
    }
  });
}

function wireParticipant() {
  elements.joinButton.addEventListener("click", async () => {
    const raffleId = elements.participantRaffle.value || findEntryRaffle()?.id || "";
    if (!raffleId) {
      showError(elements.participantResult, "Ссылка на розыгрыш открыта неверно. Проверь ссылку от админа.");
      return;
    }

    try {
      const payload = {
        telegramId: elements.participantTelegramId.value.trim(),
        username: elements.participantUsername.value.trim(),
        displayName: elements.participantDisplayName.value.trim(),
        photoUrl: state.auth.photoUrl,
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
        <small>${escapeHtml(usernameLine)} | Шанс: ${joined.participant.chancePercent}%</small>
        <small>Ты в игре. После окончания времени начнется гонка шариков с никами участников.</small>
      `;
      await refreshRaffles(raffleId);
    } catch (error) {
      showError(elements.participantResult, error.message);
    }
  });

  elements.refreshBoard.addEventListener("click", refreshLeaderboard);
  elements.participantRaffle.addEventListener("change", async () => {
    await refreshLeaderboard();
    renderClaimPrizePanel();
  });
}

function wireLinkActions() {
  document.addEventListener("click", async (event) => {
    const copyButton = event.target.closest("[data-copy-link]");
    if (copyButton) {
      const link = copyButton.dataset.copyLink || "";
      if (!link) {
        return;
      }

      try {
        await copyText(link);
        flashButtonState(copyButton, "Скопировано");
      } catch (error) {
        flashButtonState(copyButton, "Ошибка");
      }
      return;
    }

    const shareButton = event.target.closest("[data-share-link]");
    if (!shareButton) {
      return;
    }

    if (shareButton.tagName === "A") {
      return;
    }

    const link = shareButton.dataset.shareLink || "";
      const text = shareButton.dataset.shareText || "Открывай розыгрыш";
    if (!link) {
      return;
    }

    try {
      await shareLink(link, text);
      flashButtonState(shareButton, "Открыто");
    } catch (error) {
      try {
        await copyText(link);
        flashButtonState(shareButton, "Ссылка скопирована");
      } catch (copyError) {
        flashButtonState(shareButton, "Ошибка");
      }
    }
  });
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

  elements.fullscreenRace.addEventListener("click", async () => {
    await toggleRaceFullscreen();
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

  elements.winnersPanel.addEventListener("click", onClaimPrizeClick);
  elements.raceResultsOverlay.addEventListener("click", onClaimPrizeClick);
}

function wireFullscreenState() {
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement !== elements.raceStage) {
      elements.raceStage.classList.remove("is-fullscreen");
    }
  });
}

function rafflePayloadFromForm(form) {
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.prizePool = Number(payload.prizePool);
  payload.winnersCount = Number(payload.winnersCount);
  payload.durationMinutes = Number(payload.durationMinutes);
  payload.drawAt = new Date(Date.now() + payload.durationMinutes * 60 * 1000).toISOString();
  return payload;
}

function populateDurationOptions(selectElement) {
  selectElement.innerHTML = Array.from({ length: 30 }, (_, index) => {
    const minutes = index + 1;
    return `<option value="${minutes}">${formatMinutes(minutes)}</option>`;
  }).join("");
  selectElement.value = "5";
}

function updateDrawPreview(selectElement, previewElement, isTest) {
  const durationMinutes = Number(selectElement.value || 5);
  const finishAt = new Date(Date.now() + durationMinutes * 60 * 1000);
  previewElement.innerHTML = `
    <strong>Длительность: ${formatMinutes(durationMinutes)}</strong>
    <small>${isTest ? "Тестовый розыгрыш" : "Розыгрыш"} завершится автоматически через ${formatMinutes(durationMinutes)}.</small>
    <small>Ожидаемое время окончания: ${formatLocalDateTime(finishAt)}</small>
  `;
}

async function refreshRaffles(selectId) {
  const response = await api("/api/raffles");
  state.raffles = response.raffles;
  const participantRaffles = state.raffles.filter((raffle) => raffle.status === "funded");
  populateSelect(elements.participantRaffle, participantRaffles);
  populateSelect(elements.raceRaffle, state.raffles);
  updateHero();

  const entryRaffle = findEntryRaffle();
  const hasEntryRaffle = Boolean(entryRaffle && entryRaffle.status === "funded");
  const shouldLockParticipantFlow = !hasEntryRaffle;

  if (selectId) {
    elements.participantRaffle.value = selectId;
    elements.raceRaffle.value = selectId;
  } else if (entryRaffle) {
    elements.participantRaffle.value = entryRaffle.id;
    elements.raceRaffle.value = entryRaffle.id;
  }

  if (!elements.participantRaffle.value && participantRaffles[0]) {
    elements.participantRaffle.value = participantRaffles[0].id;
  }

  if (!elements.raceRaffle.value && state.raffles[0]) {
    elements.raceRaffle.value = state.raffles[0].id;
  }

  applyParticipantAccessState({
    locked: shouldLockParticipantFlow,
    message: "НЕТУ ИГР|Скоро появятся",
  });

  if (!state.raffles.length) {
    elements.winnersPanel.innerHTML = "";
    elements.claimPrizePanel.classList.add("hidden");
    clearRaceResultsOverlay();
    race.renderIdle();
  }

  await refreshLeaderboard();
  renderClaimPrizePanel();
}

async function loadHealth() {
  const response = await api("/api/health");
  state.config = response.config || state.config;
  state.auth.isAdmin = Boolean(response.viewer?.isAdmin);
  applyAdminMode();
}

async function refreshLeaderboard() {
  if (!elements.participantEmptyState.classList.contains("hidden")) {
    elements.leaderboardList.innerHTML = "";
    return;
  }

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
            <small>${escapeHtml(player.usernameLabel)}</small>
          </div>
          <div>${player.chancePercent}% шанс</div>
        </div>
      `
    )
    .join("");
}

async function loadRace(raffleId) {
  clearRaceResultsOverlay();
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
    `Победителей: ${raffle.winnersCount} | Участников: ${raffle.participantCount}`;
  renderWinners(raffle.id, raffle.winners || []);
  race.play(response.race);
  await enterRaceFullscreen();
  scheduleRaceResults(raffle.id, raffle.winners || [], response.race);
}

function renderAdminResult(raffle, payment) {
  const isFunded = raffle.status === "funded" || raffle.status === "completed";
  const paymentLink = payment?.invoiceUrl || raffle.paymentLink || raffle.crypto?.invoiceUrl || "";
  const shortNameWarning = state.config.telegramAppShortName
    ? ""
    : `<small>Внимание: не задан short name миниаппа. Без него Telegram может открыть только чат бота.</small>`;
  const shareBlock = isFunded
    ? `
      <small>Оплата подтверждена. Теперь можешь отправлять пользователям ссылку на розыгрыш.</small>
      <code>${escapeHtml(raffle.publicLink)}</code>
      ${renderLinkActions(raffle.publicLink, `Залетай в розыгрыш ${raffle.title}`)}
    `
    : `
      <small>Сначала оплати счет. Ссылка на розыгрыш появится после подтверждения оплаты.</small>
    `;

  elements.adminResult.classList.remove("hidden");
  elements.adminResult.innerHTML = `
    <strong>${isFunded ? "Розыгрыш готов к участникам" : "Сначала оплата розыгрыша"}</strong>
    <small>${escapeHtml(raffle.title)} • Сумма: ${raffle.prizePool} ${raffle.currency} • Победителей: ${raffle.winnersCount}</small>
    <small>Шаг 1: оплати счет по ссылке ниже.</small>
    <code>${escapeHtml(paymentLink)}</code>
    ${renderCopyOnlyAction(paymentLink, "Скопировать оплату")}
    <small>Шаг 2: после оплаты пользователи смогут заходить по ссылке розыгрыша и нажимать кнопку участия.</small>
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
    ${renderLinkActions(raffle.publicLink, `Залетай в розыгрыш ${raffle.title}`)}
  `;
}

function renderCopyOnlyAction(url, label) {
  if (!url) {
    return "";
  }

  return `
    <div class="link-actions">
      <button class="secondary" type="button" data-copy-link="${escapeHtml(url)}">${escapeHtml(label)}</button>
    </div>
  `;
}

function renderLinkActions(url, shareText) {
  if (!url) {
    return "";
  }

  const shareUrl = buildTelegramShareUrl(url, shareText || "Открывай розыгрыш");
  return `
    <div class="link-actions">
      <button class="secondary" type="button" data-copy-link="${escapeHtml(url)}">Скопировать ссылку</button>
      <a class="primary link-action-link" href="${escapeHtml(shareUrl)}" target="_blank" rel="noopener noreferrer">Поделиться</a>
    </div>
  `;
}

function renderWinners(raffleId, winners) {
  if (!winners.length) {
    elements.winnersPanel.innerHTML = "";
    return;
  }

  elements.winnersPanel.innerHTML = winners
    .map((winner) => renderWinnerCard(raffleId, winner, true))
    .join("");
}

function renderWinnerCard(raffleId, winner, includeStatuses) {
  const payoutStatus = winner.payout?.status || "pending";
  const notificationStatus = winner.notification?.status || "pending";
  const usernameLabel = winner.username ? `@${winner.username}` : winner.displayName;
  const canClaim = canCurrentUserClaimWinner(winner);

  return `
    <div class="winner-card">
      <div class="winner-place">${winner.place}</div>
      <div>
        <strong>${getPlaceLabel(winner.place)} — ${escapeHtml(winner.displayName)}</strong>
        <small>${escapeHtml(usernameLabel)} • ${winner.prize} ${escapeHtml(winner.payout?.asset || "USDT")}</small>
        ${includeStatuses ? `<small>Payout: ${escapeHtml(payoutStatus)} • Message: ${escapeHtml(notificationStatus)}</small>` : ""}
      </div>
      ${
        canClaim
          ? `<button class="primary claim-button-secondary" data-claim-prize="1" data-raffle-id="${escapeHtml(raffleId)}" data-telegram-id="${escapeHtml(winner.telegramId || "")}">Забрать приз</button>`
          : `<div class="winner-badge">${payoutStatus === "completed" ? "ПОЛУЧЕНО" : `TOP ${winner.place}`}</div>`
      }
    </div>
  `;
}

function renderClaimPrizePanel() {
  const raffle = getCurrentParticipantRaffle();
  const winner = findCurrentUserWinner(raffle);

  if (!raffle || !winner) {
    elements.claimPrizePanel.classList.add("hidden");
    elements.claimPrizePanel.innerHTML = "";
    return;
  }

  const alreadyClaimed = winner.payout?.status === "completed";
  const usernameLabel = winner.username ? `@${winner.username}` : winner.displayName;

  elements.claimPrizePanel.classList.remove("hidden");
  elements.claimPrizePanel.innerHTML = `
    <strong>Ты победил: ${getPlaceLabel(winner.place)}</strong>
    <small>${escapeHtml(usernameLabel)} • ${winner.prize} ${escapeHtml(winner.payout?.asset || "USDT")}</small>
    <small>${alreadyClaimed ? "Приз уже отправлен или отмечен как полученный." : "Нажми кнопку ниже, чтобы забрать приз."}</small>
    <button class="primary claim-button" ${alreadyClaimed ? "disabled" : ""} data-claim-prize-panel="1">
      ${alreadyClaimed ? "Приз получен" : "Забрать приз"}
    </button>
  `;

  const button = elements.claimPrizePanel.querySelector("[data-claim-prize-panel]");
  if (button && !alreadyClaimed) {
    button.addEventListener("click", async () => {
      await claimPrize(raffle.id, winner.telegramId);
    });
  }
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
  const totalWinners = state.raffles.reduce((sum, item) => sum + item.winnersCount, 0);

  elements.heroPool.textContent = `${totalPool} USDT`;
  elements.heroRaffles.textContent = String(state.raffles.length);
  elements.heroPlayers.textContent = String(totalPlayers);
  elements.heroInvites.textContent = String(totalWinners);
}

function setActiveTab(tab) {
  if (!canOpenTab(tab)) {
    tab = "participant";
  }
  state.activeTab = tab;
  for (const button of elements.tabs) {
    button.classList.toggle("active", button.dataset.tab === tab);
  }
  for (const panel of elements.panels) {
    panel.classList.toggle("active", panel.dataset.panel === tab);
  }
}

function canOpenTab(tab) {
  if (tab === "admin" || tab === "test" || tab === "race") {
    return state.auth.isAdmin;
  }
  return true;
}

function applyAdminMode() {
  for (const element of elements.adminOnly) {
    element.hidden = !state.auth.isAdmin;
  }

  elements.body.classList.toggle("viewer-mode", !state.auth.isAdmin);
  elements.body.classList.toggle("admin-mode", state.auth.isAdmin);

  if (!state.auth.isAdmin && !canOpenTab(state.activeTab)) {
    setActiveTab("participant");
  }

  if (state.auth.isAdmin && state.activeTab === "participant") {
    setActiveTab("admin");
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

async function toggleRaceFullscreen() {
  if (document.fullscreenElement === elements.raceStage) {
    await document.exitFullscreen();
    elements.raceStage.classList.remove("is-fullscreen");
    return;
  }

  await enterRaceFullscreen();
}

async function enterRaceFullscreen() {
  elements.raceStage.classList.add("is-fullscreen");
  if (document.fullscreenElement === elements.raceStage) {
    return;
  }

  if (elements.raceStage.requestFullscreen) {
    try {
      await elements.raceStage.requestFullscreen();
    } catch (error) {
      console.warn("fullscreen request failed", error);
    }
  }
}

function scheduleRaceResults(raffleId, winners, raceScene) {
  clearRaceResultsOverlay();
  const durations = (raceScene?.racers || []).map((racer) => Number(racer.duration) || 0);
  const revealAfterMs = Math.max(8200, ...durations) + 1200;

  state.raceResultsTimer = window.setTimeout(() => {
    renderRaceResultsOverlay(raffleId, winners);
  }, revealAfterMs);
}

function clearRaceResultsOverlay() {
  if (state.raceResultsTimer) {
    clearTimeout(state.raceResultsTimer);
    state.raceResultsTimer = null;
  }
  elements.raceResultsOverlay.classList.add("hidden");
  elements.raceResultsOverlay.innerHTML = "";
}

function renderRaceResultsOverlay(raffleId, winners) {
  if (!winners.length) {
    return;
  }

  elements.raceResultsOverlay.classList.remove("hidden");
  elements.raceResultsOverlay.innerHTML = `
    <div class="race-results-title">Победители розыгрыша</div>
    <div class="race-results-grid">
      ${winners.map((winner) => renderWinnerCard(raffleId, winner, false)).join("")}
    </div>
  `;
}

async function claimPrize(raffleId, telegramId) {
  if (!raffleId || !telegramId) {
    return;
  }

  try {
    const response = await api(`/api/raffles/${raffleId}/claim-prize`, {
      method: "POST",
      body: JSON.stringify({ telegramId }),
    });

    state.raffles = state.raffles.map((raffle) =>
      raffle.id === response.raffle.id ? response.raffle : raffle
    );

    renderClaimPrizePanel();
    if (elements.raceRaffle.value === raffleId) {
      renderWinners(raffleId, response.raffle.winners || []);
      renderRaceResultsOverlay(raffleId, response.raffle.winners || []);
    }

    elements.participantResult.classList.remove("hidden");
    elements.participantResult.innerHTML = `
      <strong>Приз забран</strong>
      <small>${escapeHtml(response.winner.displayName)} получил ${response.winner.prize} ${escapeHtml(response.winner.payout?.asset || "USDT")}</small>
    `;
  } catch (error) {
    showError(elements.participantResult, error.message);
  }
}

function onClaimPrizeClick(event) {
  const button = event.target.closest("[data-claim-prize]");
  if (!button) {
    return;
  }

  claimPrize(button.dataset.raffleId, button.dataset.telegramId);
}

function applyParticipantAccessState({ locked, message }) {
  elements.participantEmptyState.classList.toggle("hidden", !locked);
  elements.participantRaffle.disabled = locked;
  elements.joinButton.disabled = locked;
  elements.participantTelegramId.disabled = locked;
  elements.participantUsername.disabled = locked;
  elements.participantDisplayName.disabled = locked;

  if (locked) {
    const [title, subtitle] = String(message || "").split("|");
    elements.participantEmptyState.innerHTML = `
      <span>${escapeHtml(title || "НЕТУ ИГР")}</span>
      <small>${escapeHtml(subtitle || "Скоро появятся")}</small>
    `;
    elements.participantResult.classList.add("hidden");
    elements.claimPrizePanel.classList.add("hidden");
  }
}

function getCurrentParticipantRaffle() {
  return state.raffles.find((raffle) => raffle.id === elements.participantRaffle.value) || null;
}

function findCurrentUserWinner(raffle) {
  const telegramId = String(elements.participantTelegramId.value || "").trim();
  if (!raffle || !telegramId || !Array.isArray(raffle.winners)) {
    return null;
  }

  return raffle.winners.find((winner) => String(winner.telegramId || "") === telegramId) || null;
}

function canCurrentUserClaimWinner(winner) {
  const telegramId = String(elements.participantTelegramId.value || "").trim();
  if (!telegramId || String(winner.telegramId || "") !== telegramId) {
    return false;
  }

  return winner.payout?.status !== "completed";
}

function findEntryRaffle() {
  const raffleSlug = extractRaffleSlug(state.entryStartParam);
  if (!raffleSlug) {
    return null;
  }

  return (
    state.raffles.find((raffle) => raffle.slug === raffleSlug) ||
    null
  );
}

function extractRaffleSlug(startParam) {
  const value = String(startParam || "").trim();
  if (!value.startsWith("raffle_")) {
    return "";
  }
  return value.slice("raffle_".length).split("_")[0];
}

function readStartParam() {
  const params = new URLSearchParams(window.location.search);
  return params.get("startapp") || params.get("tgWebAppStartParam") || "";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(state.auth.telegramUserId
        ? { "X-Telegram-User-Id": state.auth.telegramUserId }
        : {}),
      ...(state.auth.initData
        ? { "X-Telegram-Init-Data": state.auth.initData }
        : {}),
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

function getPlaceLabel(place) {
  if (place === 1) {
    return "1 место";
  }
  if (place === 2) {
    return "2 место";
  }
  if (place === 3) {
    return "3 место";
  }
  return `${place} место`;
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

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "readonly");
  input.style.position = "absolute";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}

async function shareLink(url, text) {
  if (navigator.share) {
    await navigator.share({
      title: "Халява от Илюшки",
      text,
      url,
    });
    return;
  }

  const shareUrl = buildTelegramShareUrl(url, text);
  if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(shareUrl);
    return;
  }

  window.open(shareUrl, "_blank", "noopener,noreferrer");
}

function buildTelegramShareUrl(url, text) {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text || "Открывай розыгрыш")}`;
}

function flashButtonState(button, text) {
  const previous = button.dataset.originalLabel || button.textContent;
  button.dataset.originalLabel = previous;
  button.textContent = text;
  button.disabled = true;

  window.setTimeout(() => {
    button.textContent = previous;
    button.disabled = false;
  }, 1800);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
