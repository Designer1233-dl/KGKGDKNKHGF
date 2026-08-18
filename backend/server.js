const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const FRONTEND_DIR = path.join(ROOT, "frontend");
const DATA_DIR = path.join(ROOT, "data");
const configuredWebAppUrl = stripTrailingSlash(
  process.env.WEBAPP_URL || process.env.PUBLIC_BASE_URL || process.env.WEBHOOK_BASE_URL || ""
);
const configuredAdminIds = parseList(process.env.ADMIN_IDS);
const inferredMiniAppPath = inferMiniAppPath(
  process.env.TELEGRAM_APP_PATH,
  configuredWebAppUrl
);
const CONFIG = {
  appName: process.env.APP_NAME || "NeonDrop Raffle",
  port: Number(process.env.PORT || 3000),
  publicBaseUrl: configuredWebAppUrl,
  webhookBaseUrl: stripTrailingSlash(
    process.env.WEBHOOK_BASE_URL || getUrlOrigin(configuredWebAppUrl) || configuredWebAppUrl
  ),
  botUsername: process.env.BOT_USERNAME || "your_bot",
  telegramAppPath: inferredMiniAppPath,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "",
  telegramAdminChatId:
    process.env.TELEGRAM_ADMIN_CHAT_ID ||
    configuredAdminIds[0] ||
    process.env.BET_LOG_CHAT_ID ||
    "",
  adminIds: configuredAdminIds,
  betLogChatId: process.env.BET_LOG_CHAT_ID || configuredAdminIds[0] || "",
  payoutReviewChatId: process.env.PAYOUT_REVIEW_CHAT_ID || configuredAdminIds[0] || "",
  telegramNotifyWinners: parseBoolean(process.env.TELEGRAM_NOTIFY_WINNERS, true),
  cryptoPayApiToken: process.env.CRYPTO_PAY_API_TOKEN || "",
  cryptoPayBaseUrl: stripTrailingSlash(
    process.env.CRYPTO_PAY_BASE_URL ||
      (parseBoolean(process.env.CRYPTO_PAY_USE_TESTNET, false)
        ? "https://testnet-pay.crypt.bot"
        : "https://pay.crypt.bot")
  ),
  cryptoPayWebhookPath: ensureLeadingSlash(
    process.env.CRYPTO_PAY_WEBHOOK_PATH || "/api/webhooks/crypto-pay"
  ),
  cryptoPayInvoiceExpiresIn: Number(process.env.CRYPTO_PAY_INVOICE_EXPIRES_IN || 3600),
  cryptoPaySwapTo: process.env.CRYPTO_PAY_SWAP_TO || "",
  cryptoPayPaidBtnName: process.env.CRYPTO_PAY_PAID_BTN_NAME || "callback",
  cryptoBotUsername:
    process.env.CRYPTOBOT_USERNAME ||
    (parseBoolean(process.env.CRYPTO_PAY_USE_TESTNET, false)
      ? "CryptoTestnetBot"
      : "CryptoBot"),
  autoConfirmPayments: parseBoolean(process.env.AUTO_CONFIRM_PAYMENTS, true),
  autoPayouts: parseBoolean(process.env.AUTO_PAYOUTS, true),
  disableTransferNotifications: parseBoolean(
    process.env.DISABLE_TRANSFER_NOTIFICATIONS,
    false
  ),
  dataFilePath: process.env.DATA_FILE_PATH
    ? path.resolve(process.env.DATA_FILE_PATH)
    : process.env.DB_PATH
      ? path.resolve(process.env.DB_PATH)
    : path.join(DATA_DIR, "store.json"),
  defaultAsset: process.env.CRYPTO_PAY_ASSET || "USDT",
  webhookSecretToken: process.env.WEBHOOK_SECRET_TOKEN || "",
  corsOrigin: process.env.CORS_ORIGIN || "*",
};
const DATA_FILE = CONFIG.dataFilePath;

ensureDataFile();
const state = loadState();

setInterval(() => {
  autoFinalizeDueRaffles().catch((error) => {
    console.error("auto finalize failed", error);
  });
}, 5000);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (req.method === "OPTIONS") {
      sendNoContent(res);
      return;
    }

    if (pathname.startsWith("/api/")) {
      const body = await readRequestBody(req);
      await handleApi(req, res, url, body);
      return;
    }

    serveStatic(pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "internal_error", message: error.message });
  }
});

server.listen(CONFIG.port, () => {
  console.log(`${CONFIG.appName} server listening on http://localhost:${CONFIG.port}`);
});

async function handleApi(req, res, url, body) {
  const { pathname, searchParams } = url;
  const method = req.method || "GET";

  if (method === "POST" && pathname === CONFIG.cryptoPayWebhookPath) {
    await handleCryptoPayWebhook(req, res, body);
    return;
  }

  if (method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      now: new Date().toISOString(),
      config: {
        appName: CONFIG.appName,
        publicBaseUrl: CONFIG.publicBaseUrl,
        webhookBaseUrl: CONFIG.webhookBaseUrl,
        botUsername: CONFIG.botUsername,
        telegramAppPath: CONFIG.telegramAppPath,
        paymentMode: CONFIG.cryptoPayApiToken ? "cryptopay" : "mock",
        cryptoPayConfigured: Boolean(CONFIG.cryptoPayApiToken),
        telegramConfigured: Boolean(CONFIG.telegramBotToken),
        autoConfirmPayments: shouldAutoConfirmPayments(),
        autoPayouts: CONFIG.autoPayouts,
        webhookPath: CONFIG.cryptoPayWebhookPath,
      },
    });
    return;
  }

  if (method === "GET" && pathname === "/api/raffles") {
    sendJson(res, 200, {
      raffles: state.raffles
        .slice()
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map(withComputedFields),
    });
    return;
  }

  if (method === "POST" && pathname === "/api/raffles") {
    const raffle = createRaffle(body.json || {});
    state.raffles.push(raffle);
    persistState();
    sendJson(res, 201, { raffle: withComputedFields(raffle) });
    return;
  }

  const paymentMatch = pathname.match(/^\/api\/payments\/([^/]+)\/confirm$/);
  if (method === "POST" && paymentMatch) {
    const paymentId = paymentMatch[1];
    const payment = state.payments.find((item) => item.id === paymentId);
    if (!payment) {
      sendJson(res, 404, { error: "payment_not_found" });
      return;
    }

    const raffle = state.raffles.find((item) => item.id === payment.raffleId);
    await syncAndConfirmPayment(payment, raffle);
    persistState();
    sendJson(res, 200, {
      payment,
      raffle: raffle ? withComputedFields(raffle) : null,
    });
    return;
  }

  const raffleMatch = pathname.match(/^\/api\/raffles\/([^/]+)(?:\/(.+))?$/);
  if (!raffleMatch) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  const raffleId = raffleMatch[1];
  const action = raffleMatch[2] || "";
  const raffle = state.raffles.find((item) => item.id === raffleId);

  if (!raffle) {
    sendJson(res, 404, { error: "raffle_not_found" });
    return;
  }

  if (method === "GET" && action === "") {
    sendJson(res, 200, { raffle: withComputedFields(raffle) });
    return;
  }

  if (method === "POST" && action === "payment-intent") {
    const payment = await createPaymentIntent(raffle);
    state.payments.push(payment);
    raffle.status = "awaiting_payment";
    raffle.crypto = {
      paymentId: payment.id,
      invoiceId: payment.providerInvoiceId,
      invoiceUrl: payment.invoiceUrl,
      invoiceHash: payment.providerInvoiceHash,
      status: payment.status,
      mode: payment.mode,
    };

    if (shouldAutoConfirmPayments() && payment.mode === "mock") {
      confirmPayment(payment, raffle, { source: "auto_mock" });
    }

    persistState();
    sendJson(res, 201, { payment, raffle: withComputedFields(raffle) });
    return;
  }

  if (method === "POST" && action === "join") {
    const result = joinRaffle(raffle, body.json || {});
    persistState();
    sendJson(res, 201, {
      raffle: withComputedFields(raffle),
      participant: result.participant,
      referralLink: result.referralLink,
    });
    return;
  }

  if (method === "POST" && action === "finalize") {
    if (!raffle.drawAt) {
      sendJson(res, 400, { error: "draw_time_required" });
      return;
    }

    await finalizeRaffle(raffle, {
      force: searchParams.get("force") === "1",
    });
    persistState();
    sendJson(res, 200, { raffle: withComputedFields(raffle) });
    return;
  }

  if (method === "POST" && action === "settle") {
    await settleCompletedRaffle(raffle, { retryFailed: true });
    persistState();
    sendJson(res, 200, { raffle: withComputedFields(raffle) });
    return;
  }

  if (method === "GET" && action === "leaderboard") {
    const leaderboard = buildLeaderboard(raffle).slice(0, 20);
    sendJson(res, 200, { leaderboard });
    return;
  }

  if (method === "GET" && action === "race") {
    if (raffle.status !== "completed") {
      sendJson(res, 409, { error: "raffle_not_completed" });
      return;
    }

    sendJson(res, 200, { race: raffle.race });
    return;
  }

  sendJson(res, 404, { error: "not_found" });
}

function createRaffle(body) {
  const prizePool = Number(body.prizePool);
  const winnersCount = Number(body.winnersCount);
  const drawAt = body.drawAt;

  if (!body.title || !Number.isFinite(prizePool) || prizePool <= 0) {
    throw new Error("title and valid prizePool are required");
  }

  if (!Number.isFinite(winnersCount) || winnersCount < 1) {
    throw new Error("valid winnersCount is required");
  }

  return {
    id: crypto.randomUUID(),
    slug: randomSlug(),
    title: body.title,
    description: body.description || "",
    channel: body.channel || "",
    prizePool,
    currency: body.currency || CONFIG.defaultAsset,
    winnersCount,
    prizePerWinner: roundMoney(prizePool / winnersCount),
    drawAt,
    createdAt: new Date().toISOString(),
    status: "draft",
    adminName: body.adminName || "Admin",
    participants: [],
    winners: [],
    referrals: [],
    crypto: null,
    race: null,
    settlement: {
      status: "pending",
      lastProcessedAt: null,
      notificationSummary: null,
    },
  };
}

async function createPaymentIntent(raffle) {
  const payment = {
    id: `pay_${crypto.randomUUID().slice(0, 8)}`,
    raffleId: raffle.id,
    amount: raffle.prizePool,
    currency: raffle.currency,
    status: "pending",
    createdAt: new Date().toISOString(),
    mode: CONFIG.cryptoPayApiToken ? "cryptopay" : "mock",
    invoiceUrl: null,
    providerInvoiceId: null,
    providerInvoiceHash: null,
    payload: null,
  };

  payment.payload = JSON.stringify({
    type: "raffle_payment",
    raffleId: raffle.id,
    paymentId: payment.id,
  });

  if (!CONFIG.cryptoPayApiToken) {
    const invoiceUsername = CONFIG.cryptoBotUsername.replace(/^@/, "") || "CryptoBot";
    payment.invoiceUrl = `https://t.me/${invoiceUsername}?start=invoice-${payment.id}`;
    return payment;
  }

  const result = await cryptoPayRequest("createInvoice", {
    asset: raffle.currency,
    amount: String(raffle.prizePool),
    description: `Fund raffle: ${raffle.title}`,
    hidden_message: `Payment received for raffle ${raffle.title}.`,
    paid_btn_name: CONFIG.cryptoPayPaidBtnName,
    paid_btn_url: buildMiniAppLink(`raffle_${raffle.slug}`),
    payload: payment.payload,
    allow_comments: false,
    allow_anonymous: false,
    expires_in: CONFIG.cryptoPayInvoiceExpiresIn,
    ...(CONFIG.cryptoPaySwapTo ? { swap_to: CONFIG.cryptoPaySwapTo } : {}),
  });

  payment.providerInvoiceId = result.invoice_id;
  payment.providerInvoiceHash = result.hash;
  payment.invoiceUrl =
    result.mini_app_invoice_url ||
    result.bot_invoice_url ||
    result.web_app_invoice_url ||
    buildMiniAppLink(`raffle_${raffle.slug}`);
  payment.providerResponse = {
    status: result.status,
    expiresAt: result.expiration_date || null,
  };
  return payment;
}

async function syncAndConfirmPayment(payment, raffle) {
  if (payment.status === "paid") {
    return payment;
  }

  if (payment.mode === "mock") {
    confirmPayment(payment, raffle, { source: "manual_mock" });
    return payment;
  }

  if (!CONFIG.cryptoPayApiToken || !payment.providerInvoiceId) {
    throw new Error("payment_is_not_configured");
  }

  const result = await cryptoPayRequest("getInvoices", {
    invoice_ids: String(payment.providerInvoiceId),
  });
  const invoices = Array.isArray(result.items) ? result.items : result;
  const invoice = Array.isArray(invoices) ? invoices[0] : null;

  if (!invoice) {
    throw new Error("invoice_not_found");
  }

  payment.providerResponse = {
    ...(payment.providerResponse || {}),
    status: invoice.status,
    paidAt: invoice.paid_at || null,
  };

  if (invoice.status !== "paid") {
    throw new Error("invoice_not_paid_yet");
  }

  confirmPayment(payment, raffle, {
    source: "cryptopay_sync",
    providerInvoice: invoice,
  });
  return payment;
}

function confirmPayment(payment, raffle, options = {}) {
  payment.status = "paid";
  payment.paidAt = new Date().toISOString();
  payment.confirmedBy = options.source || "system";
  if (options.providerInvoice) {
    payment.providerResponse = {
      ...(payment.providerResponse || {}),
      status: options.providerInvoice.status,
      paidAt: options.providerInvoice.paid_at || payment.paidAt,
      paidAsset: options.providerInvoice.paid_asset || null,
      paidAmount: options.providerInvoice.paid_amount || null,
    };
  }

  if (!raffle) {
    return;
  }

  raffle.status = "funded";
  raffle.fundedAt = payment.paidAt;
  raffle.crypto = {
    paymentId: payment.id,
    invoiceId: payment.providerInvoiceId,
    invoiceUrl: payment.invoiceUrl,
    invoiceHash: payment.providerInvoiceHash,
    status: payment.status,
    mode: payment.mode,
  };
}

function joinRaffle(raffle, body) {
  if (raffle.status !== "funded" && raffle.status !== "completed") {
    throw new Error("raffle is not active yet");
  }

  const telegramId = String(body.telegramId || "").trim();
  const username = String(body.username || "").trim();
  const displayName = String(body.displayName || username || "Player").trim();
  const refCode = String(body.ref || "").trim();

  if (!telegramId || !displayName) {
    throw new Error("telegramId and displayName are required");
  }

  const existing = raffle.participants.find((item) => item.telegramId === telegramId);
  if (existing) {
    return {
      participant: withParticipantComputed(existing, raffle),
      referralLink: buildReferralLink(raffle, existing.refCode),
    };
  }

  const participant = {
    id: crypto.randomUUID(),
    telegramId,
    username,
    displayName,
    joinedAt: new Date().toISOString(),
    refCode: `ref_${crypto.randomUUID().slice(0, 6)}`,
    invitedBy: null,
    invitesCount: 0,
    weight: 1,
  };

  if (refCode) {
    const referrer = raffle.participants.find((item) => item.refCode === refCode);
    if (referrer && referrer.telegramId !== telegramId) {
      participant.invitedBy = referrer.id;
      referrer.invitesCount += 1;
      referrer.weight = 1 + referrer.invitesCount;
      raffle.referrals.push({
        id: crypto.randomUUID(),
        referrerId: referrer.id,
        invitedId: participant.id,
        createdAt: new Date().toISOString(),
      });
    }
  }

  raffle.participants.push(participant);
  return {
    participant: withParticipantComputed(participant, raffle),
    referralLink: buildReferralLink(raffle, participant.refCode),
  };
}

async function finalizeRaffle(raffle, options = {}) {
  if (raffle.status !== "completed") {
    if (raffle.status !== "funded" && !options.force) {
      throw new Error("raffle must be funded first");
    }

    if (!options.force && new Date(raffle.drawAt).getTime() > Date.now()) {
      throw new Error("draw time has not come yet");
    }

    const pool = raffle.participants.map((item) => ({
      id: item.id,
      weight: Math.max(1, item.weight || 1),
    }));

    const winners = pickWeightedWinners(pool, Math.min(raffle.winnersCount, pool.length));
    raffle.winners = winners.map((winnerId, index) => {
      const participant = raffle.participants.find((item) => item.id === winnerId);
      return {
        place: index + 1,
        participantId: winnerId,
        telegramId: participant ? participant.telegramId : null,
        username: participant ? participant.username : "",
        displayName: participant ? participant.displayName : "Unknown",
        prize: raffle.prizePerWinner,
        payout: {
          status: "pending",
          asset: raffle.currency,
          transferId: null,
          spendId: `raffle_${raffle.id}_place_${index + 1}`,
          error: null,
          processedAt: null,
        },
        notification: {
          status: "pending",
          messageId: null,
          error: null,
          sentAt: null,
        },
      };
    });

    raffle.status = "completed";
    raffle.completedAt = new Date().toISOString();
    raffle.race = buildRacePayload(raffle);
  }

  await settleCompletedRaffle(raffle, options);
  return raffle;
}

async function settleCompletedRaffle(raffle, options = {}) {
  if (raffle.status !== "completed") {
    throw new Error("raffle_not_completed");
  }

  let hasFailure = false;

  for (const winner of raffle.winners) {
    const participant = raffle.participants.find((item) => item.id === winner.participantId);
    if (participant) {
      winner.telegramId = participant.telegramId;
      winner.username = participant.username;
      winner.displayName = participant.displayName;
    }

    if (options.retryFailed || winner.payout.status === "pending") {
      try {
        await payoutWinner(raffle, winner);
      } catch (error) {
        hasFailure = true;
        winner.payout.status = "failed";
        winner.payout.error = error.message;
        winner.payout.processedAt = new Date().toISOString();
      }
    }

    if (
      CONFIG.telegramNotifyWinners &&
      (options.retryFailed || winner.notification.status === "pending")
    ) {
      try {
        await notifyWinner(raffle, winner);
      } catch (error) {
        hasFailure = true;
        winner.notification.status = "failed";
        winner.notification.error = error.message;
        winner.notification.sentAt = new Date().toISOString();
      }
    }
  }

  const nextStatus = hasFailure ? "partial_failure" : "completed";
  const previousStatus = raffle.settlement?.status;
  const previousAdminNotifiedAt = raffle.settlement?.adminNotifiedAt;
  raffle.settlement = {
    status: nextStatus,
    lastProcessedAt: new Date().toISOString(),
    notificationSummary: summarizeSettlement(raffle),
    adminNotifiedAt: previousAdminNotifiedAt || null,
  };

  const shouldNotifyAdmin =
    !raffle.settlement.adminNotifiedAt ||
    (previousStatus && previousStatus !== nextStatus && nextStatus === "completed");

  if (shouldNotifyAdmin) {
    try {
      await notifyAdminAboutResults(raffle);
      raffle.settlement.adminNotifiedAt = new Date().toISOString();
    } catch (error) {
      console.error("admin result notification failed", error);
    }
  }
}

async function payoutWinner(raffle, winner) {
  if (winner.payout.status === "completed") {
    return;
  }

  if (!CONFIG.autoPayouts) {
    winner.payout.status = "skipped";
    winner.payout.error = "auto_payouts_disabled";
    winner.payout.processedAt = new Date().toISOString();
    return;
  }

  if (!CONFIG.cryptoPayApiToken) {
    winner.payout.status = "pending_configuration";
    winner.payout.error = "missing_crypto_pay_api_token";
    winner.payout.processedAt = new Date().toISOString();
    return;
  }

  if (!winner.telegramId) {
    throw new Error("missing_winner_telegram_id");
  }

  const result = await cryptoPayRequest("transfer", {
    user_id: Number(winner.telegramId),
    asset: winner.payout.asset,
    amount: String(winner.prize),
    spend_id: winner.payout.spendId,
    comment: `Prize for ${raffle.title} (#${winner.place})`,
    disable_send_notification: CONFIG.disableTransferNotifications,
  });

  winner.payout.status = "completed";
  winner.payout.transferId = result.transfer_id || null;
  winner.payout.error = null;
  winner.payout.processedAt = new Date().toISOString();
}

async function notifyWinner(raffle, winner) {
  if (winner.notification.status === "sent") {
    return;
  }

  if (!CONFIG.telegramBotToken) {
    winner.notification.status = "pending_configuration";
    winner.notification.error = "missing_telegram_bot_token";
    winner.notification.sentAt = new Date().toISOString();
    return;
  }

  if (!winner.telegramId) {
    throw new Error("missing_winner_telegram_id");
  }

  const lines = [
    `You won in ${raffle.title}!`,
    `Place: #${winner.place}`,
    `Prize: ${winner.prize} ${winner.payout.asset}`,
  ];

  if (winner.payout.status === "completed") {
    lines.push("Your prize transfer has already been sent via CryptoBot.");
  } else if (winner.payout.status === "pending_configuration") {
    lines.push("Prize transfer is queued and will be processed after payout configuration.");
  } else if (winner.payout.status === "failed") {
    lines.push("Prize payout hit a temporary issue. The team will retry it shortly.");
  }

  lines.push("");
  lines.push(`Open raffle: ${buildMiniAppLink(`raffle_${raffle.slug}`)}`);

  const message = await telegramRequest("sendMessage", {
    chat_id: winner.telegramId,
    text: lines.join("\n"),
  });

  winner.notification.status = "sent";
  winner.notification.messageId = message.message_id || null;
  winner.notification.error = null;
  winner.notification.sentAt = new Date().toISOString();
}

async function notifyAdminAboutResults(raffle) {
  if (!CONFIG.telegramBotToken) {
    return;
  }

  const summary = summarizeSettlement(raffle);
  const text = [
    `${raffle.title} completed`,
    `Winners: ${raffle.winners.length}`,
    `Payouts: ${summary.payoutsCompleted}/${raffle.winners.length} completed`,
    `Notifications: ${summary.notificationsSent}/${raffle.winners.length} sent`,
    `Status: ${raffle.settlement.status}`,
  ].join("\n");

  await sendTelegramMessageToTargets(getAdminResultTargets(raffle), text);
}

async function autoFinalizeDueRaffles() {
  let changed = false;

  for (const raffle of state.raffles) {
    if (
      raffle.status === "funded" &&
      raffle.drawAt &&
      new Date(raffle.drawAt).getTime() <= Date.now()
    ) {
      await finalizeRaffle(raffle, { force: true });
      changed = true;
    } else if (
      raffle.status === "completed" &&
      raffle.settlement &&
      raffle.settlement.status !== "completed"
    ) {
      await settleCompletedRaffle(raffle, { retryFailed: true });
      changed = true;
    }
  }

  if (changed) {
    persistState();
  }
}

function buildRacePayload(raffle) {
  const sortedParticipants = buildLeaderboard(raffle);
  const finalists = sortedParticipants.slice(0, Math.min(18, sortedParticipants.length));
  const winnerOrder = raffle.winners.map((item) => item.participantId);
  const baseDuration = 9800;

  const racers = finalists.map((participant, index) => {
    const winnerIndex = winnerOrder.indexOf(participant.id);
    const isWinner = winnerIndex !== -1;
    const lane = index;
    const duration = isWinner
      ? 6200 + winnerIndex * 650
      : baseDuration + index * 180 + Math.round(Math.random() * 900);

    return {
      id: participant.id,
      displayName: participant.displayName,
      invitesCount: participant.invitesCount,
      chanceWeight: participant.weight,
      isWinner,
      finishPlace: isWinner ? winnerIndex + 1 : null,
      lane,
      color: pickColor(index),
      seed: hashNumber(`${raffle.id}:${participant.id}`),
      duration,
    };
  });

  return {
    raffleId: raffle.id,
    title: raffle.title,
    winnersCount: raffle.winnersCount,
    prizePerWinner: raffle.prizePerWinner,
    racers,
    obstacles: buildObstacles(finalists.length),
    generatedAt: new Date().toISOString(),
  };
}

function buildObstacles(racersCount) {
  const obstacles = [];
  const rows = Math.max(5, Math.ceil(racersCount / 3));

  for (let row = 0; row < rows; row += 1) {
    const count = row % 2 === 0 ? 4 : 5;
    for (let col = 0; col < count; col += 1) {
      obstacles.push({
        x: 110 + col * 90 + (row % 2 ? 40 : 0),
        y: 100 + row * 72,
        r: 10 + ((row + col) % 3),
      });
    }
  }

  return obstacles;
}

function buildLeaderboard(raffle) {
  return raffle.participants
    .map((item) => withParticipantComputed(item, raffle))
    .sort((a, b) => b.weight - a.weight || b.invitesCount - a.invitesCount);
}

function withParticipantComputed(participant, raffle) {
  const totalWeight = raffle.participants.reduce(
    (sum, item) => sum + Math.max(1, item.weight || 1),
    0
  );
  const participantWeight = Math.max(1, participant.weight || 1);

  return {
    ...participant,
    chancePercent: totalWeight ? Number(((participantWeight / totalWeight) * 100).toFixed(2)) : 0,
  };
}

function withComputedFields(raffle) {
  return {
    ...raffle,
    participantCount: raffle.participants.length,
    totalWeight: raffle.participants.reduce(
      (sum, item) => sum + Math.max(1, item.weight || 1),
      0
    ),
    inviteCount: raffle.referrals.length,
    publicLink: buildMiniAppLink(`raffle_${raffle.slug}`),
    leaderboard: buildLeaderboard(raffle).slice(0, 8),
  };
}

function pickWeightedWinners(pool, count) {
  const winners = [];
  const available = pool.slice();

  while (available.length && winners.length < count) {
    const total = available.reduce((sum, item) => sum + item.weight, 0);
    let cursor = Math.random() * total;
    let selectedIndex = 0;

    for (let index = 0; index < available.length; index += 1) {
      cursor -= available[index].weight;
      if (cursor <= 0) {
        selectedIndex = index;
        break;
      }
    }

    winners.push(available[selectedIndex].id);
    available.splice(selectedIndex, 1);
  }

  return winners;
}

function buildReferralLink(raffle, refCode) {
  return buildMiniAppLink(`raffle_${raffle.slug}_${refCode}`);
}

function pickColor(index) {
  const palette = ["#52f2ff", "#ff4fd8", "#c8ff5c", "#ffd56f", "#8f7cff", "#ff7a59"];
  return palette[index % palette.length];
}

function hashNumber(text) {
  const hash = crypto.createHash("sha1").update(text).digest("hex");
  return parseInt(hash.slice(0, 8), 16);
}

async function handleCryptoPayWebhook(req, res, body) {
  if (!CONFIG.cryptoPayApiToken) {
    sendJson(res, 409, { error: "crypto_pay_not_configured" });
    return;
  }

  if (!verifyCryptoPaySignature(body.raw, req.headers["crypto-pay-api-signature"])) {
    sendJson(res, 401, { error: "invalid_signature" });
    return;
  }

  const update = body.json || {};
  recordWebhookEvent(update);

  if (update.update_type === "invoice_paid" && update.payload) {
    await processInvoicePaidWebhook(update.payload);
    persistState();
  }

  sendJson(res, 200, { ok: true });
}

async function processInvoicePaidWebhook(invoice) {
  const payment = findPaymentByInvoice(invoice);
  if (!payment) {
    return;
  }

  const raffle = state.raffles.find((item) => item.id === payment.raffleId);
  confirmPayment(payment, raffle, {
    source: "cryptopay_webhook",
    providerInvoice: invoice,
  });

  await notifyAdminAboutPayment(raffle, payment);
}

function findPaymentByInvoice(invoice) {
  if (invoice.payload) {
    try {
      const parsed = JSON.parse(invoice.payload);
      if (parsed.paymentId) {
        const byId = state.payments.find((item) => item.id === parsed.paymentId);
        if (byId) {
          return byId;
        }
      }
    } catch (error) {
      // Ignore payload parse errors and continue with invoice id matching.
    }
  }

  return state.payments.find(
    (item) => String(item.providerInvoiceId) === String(invoice.invoice_id)
  );
}

async function notifyAdminAboutPayment(raffle, payment) {
  if (!CONFIG.telegramBotToken || !raffle) {
    return;
  }

  const text = [
    `Payment received for ${raffle.title}`,
    `Amount: ${payment.amount} ${payment.currency}`,
    `Raffle status: ${raffle.status}`,
  ].join("\n");

  await sendTelegramMessageToTargets(getPaymentLogTargets(), text);
}

function recordWebhookEvent(update) {
  if (!state.webhooks) {
    state.webhooks = [];
  }

  state.webhooks.unshift({
    id: crypto.randomUUID(),
    updateType: update.update_type || "unknown",
    requestDate: update.request_date || new Date().toISOString(),
    payloadInvoiceId: update.payload ? update.payload.invoice_id : null,
  });
  state.webhooks = state.webhooks.slice(0, 100);
}

async function cryptoPayRequest(method, params) {
  if (!CONFIG.cryptoPayApiToken) {
    throw new Error("missing_crypto_pay_api_token");
  }

  const response = await fetch(`${CONFIG.cryptoPayBaseUrl}/api/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Crypto-Pay-API-Token": CONFIG.cryptoPayApiToken,
    },
    body: JSON.stringify(params || {}),
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `crypto_pay_${method}_failed`);
  }

  return data.result;
}

async function telegramRequest(method, params) {
  if (!CONFIG.telegramBotToken) {
    throw new Error("missing_telegram_bot_token");
  }

  const response = await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params || {}),
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.description || `telegram_${method}_failed`);
  }

  return data.result;
}

async function sendTelegramMessageToTargets(targets, text) {
  for (const chatId of uniqueTargets(targets)) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text,
    });
  }
}

function getPaymentLogTargets() {
  return [CONFIG.betLogChatId, CONFIG.telegramAdminChatId, ...CONFIG.adminIds];
}

function getAdminResultTargets(raffle) {
  const targets = [CONFIG.telegramAdminChatId, ...CONFIG.adminIds];
  if (raffle.settlement && raffle.settlement.status !== "completed") {
    targets.push(CONFIG.payoutReviewChatId);
  }
  return targets;
}

function verifyCryptoPaySignature(rawBody, signature) {
  if (!signature) {
    return false;
  }

  const secret = crypto.createHash("sha256").update(CONFIG.cryptoPayApiToken).digest();
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return digest === signature;
}

function summarizeSettlement(raffle) {
  const payoutsCompleted = raffle.winners.filter(
    (winner) => winner.payout && winner.payout.status === "completed"
  ).length;
  const notificationsSent = raffle.winners.filter(
    (winner) => winner.notification && winner.notification.status === "sent"
  ).length;

  return {
    payoutsCompleted,
    notificationsSent,
  };
}

function serveStatic(pathname, res) {
  const miniAppPath = CONFIG.telegramAppPath ? `/${CONFIG.telegramAppPath}` : "";
  const requested =
    pathname === "/" || pathname === miniAppPath || pathname === `${miniAppPath}/`
      ? "/index.html"
      : pathname;
  const filePath = path.normalize(path.join(FRONTEND_DIR, requested));

  if (!filePath.startsWith(FRONTEND_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, file) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }

    res.writeHead(200, { "Content-Type": getContentType(filePath) });
    res.end(file);
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath);
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    }[ext] || "application/octet-stream"
  );
}

function ensureDataFile() {
  const dataDir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          raffles: [],
          payments: [],
          webhooks: [],
        },
        null,
        2
      )
    );
  }
}

function loadState() {
  const loaded = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  return {
    raffles: Array.isArray(loaded.raffles) ? loaded.raffles : [],
    payments: Array.isArray(loaded.payments) ? loaded.payments : [],
    webhooks: Array.isArray(loaded.webhooks) ? loaded.webhooks : [],
  };
}

function persistState() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    req.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const raw = buffer.toString("utf8");
      if (!raw) {
        resolve({ raw: "", json: {} });
        return;
      }

      try {
        resolve({ raw, json: JSON.parse(raw) });
      } catch (error) {
        reject(new Error("invalid_json"));
      }
    });

    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": CONFIG.corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Crypto-Pay-API-Token, Crypto-Pay-API-Signature",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function sendNoContent(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": CONFIG.corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Crypto-Pay-API-Token, Crypto-Pay-API-Signature",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end();
}

function randomSlug() {
  return crypto.randomBytes(4).toString("hex");
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function buildMiniAppLink(startapp) {
  if (CONFIG.publicBaseUrl) {
    return `${CONFIG.publicBaseUrl}?startapp=${encodeURIComponent(startapp)}`;
  }

  const botUsername = CONFIG.botUsername.replace(/^@/, "") || "your_bot";
  const appPath = CONFIG.telegramAppPath ? `/${CONFIG.telegramAppPath}` : "";
  return `https://t.me/${botUsername}${appPath}?startapp=${encodeURIComponent(startapp)}`;
}

function shouldAutoConfirmPayments() {
  return !CONFIG.cryptoPayApiToken && CONFIG.autoConfirmPayments;
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function trimSlashes(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function ensureLeadingSlash(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "/";
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function parseBoolean(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueTargets(values) {
  return Array.from(new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean)));
}

function inferMiniAppPath(explicitPath, publicUrl) {
  const normalizedExplicitPath = trimSlashes(explicitPath || "");
  if (normalizedExplicitPath) {
    return normalizedExplicitPath;
  }

  if (!publicUrl) {
    return "app";
  }

  try {
    const parsed = new URL(publicUrl);
    const normalizedPath = trimSlashes(parsed.pathname);
    return normalizedPath || "app";
  } catch (error) {
    return "app";
  }
}

function getUrlOrigin(value) {
  if (!value) {
    return "";
  }

  try {
    return new URL(value).origin;
  } catch (error) {
    return "";
  }
}
