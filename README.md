# NeonDrop Raffle Mini App

Telegram Mini App for paid raffles with Crypto Pay invoices, auto winner notifications, auto payout flow, and a neon race finale.

## Main file

```text
backend/server.js
```

## Start command

```bash
node backend/server.js
```

## Environment variables

Use these in Bothost exactly in this style:

```env
APP_NAME=NeonDrop Raffle
PORT=3000

WEBHOOK_BASE_URL=https://your-domain.bothost.tech
WEBAPP_URL=https://your-domain.bothost.tech/mini-app

BOT_USERNAME=your_bot
BOT_TOKEN=token_from_botfather
WEBHOOK_SECRET_TOKEN=any_long_random_secret

ADMIN_IDS=123456789
BET_LOG_CHAT_ID=-100xxxxxxxxxx
PAYOUT_REVIEW_CHAT_ID=-100xxxxxxxxxx
TELEGRAM_NOTIFY_WINNERS=true

CRYPTO_PAY_API_TOKEN=token_from_cryptobot
CRYPTO_PAY_BASE_URL=https://pay.crypt.bot/api
CRYPTO_PAY_ASSET=USDT
CRYPTO_PAY_USE_TESTNET=false
CRYPTO_PAY_WEBHOOK_PATH=/api/webhooks/crypto-pay
CRYPTO_PAY_INVOICE_EXPIRES_IN=3600
CRYPTO_PAY_SWAP_TO=
CRYPTO_PAY_PAID_BTN_NAME=callback
CRYPTOBOT_USERNAME=CryptoBot
AUTO_PAYOUTS=true
DISABLE_TRANSFER_NOTIFICATIONS=false

AUTO_CONFIRM_PAYMENTS=false
DB_PATH=./data/store.json
CORS_ORIGIN=*
```

## What each variable means

- `APP_NAME` - app name in logs
- `PORT` - port for the Node server
- `WEBHOOK_BASE_URL` - public base domain of your deployed project
- `WEBAPP_URL` - exact public URL of the Mini App, for example `https://your-domain.bothost.tech/mini-app`
- `BOT_USERNAME` - Telegram bot username without `@`
- `BOT_TOKEN` - Telegram bot token from `@BotFather`
- `WEBHOOK_SECRET_TOKEN` - reserved secret value for future webhook hardening
- `ADMIN_IDS` - comma-separated Telegram admin user IDs
- `BET_LOG_CHAT_ID` - chat where the bot sends payment notifications
- `PAYOUT_REVIEW_CHAT_ID` - chat where the bot sends payout issue notifications
- `TELEGRAM_NOTIFY_WINNERS` - send Telegram messages to winners after the draw
- `CRYPTO_PAY_API_TOKEN` - Crypto Pay API token from `@CryptoBot` or `@CryptoTestnetBot`
- `CRYPTO_PAY_BASE_URL` - Crypto Pay API base URL
- `CRYPTO_PAY_ASSET` - default raffle asset, usually `USDT`
- `CRYPTO_PAY_USE_TESTNET` - use testnet mode if `true`
- `CRYPTO_PAY_WEBHOOK_PATH` - path for Crypto Pay webhook updates
- `CRYPTO_PAY_INVOICE_EXPIRES_IN` - invoice lifetime in seconds
- `CRYPTO_PAY_SWAP_TO` - optional payout conversion asset
- `CRYPTO_PAY_PAID_BTN_NAME` - button type after payment, keep `callback`
- `CRYPTOBOT_USERNAME` - usually `CryptoBot`, for testnet use `CryptoTestnetBot`
- `AUTO_PAYOUTS` - automatically send prizes after the raffle completes
- `DISABLE_TRANSFER_NOTIFICATIONS` - disable transfer notifications from Crypto Pay
- `AUTO_CONFIRM_PAYMENTS` - mock-only fallback for local testing without real Crypto Pay
- `DB_PATH` - local JSON storage file path used by this project
- `CORS_ORIGIN` - allowed browser origin for API requests

## Bothost setup

1. Upload the project.
2. Set main file to `backend/server.js`.
3. Set start command to `node backend/server.js`.
4. Add the environment variables from the block above.
5. Open `https://your-domain.bothost.tech/api/health` and confirm it returns `ok: true`.
6. Open `https://your-domain.bothost.tech/mini-app` and confirm the interface loads.

## Telegram setup

1. Create a bot in `@BotFather`.
2. Copy the bot token into `BOT_TOKEN`.
3. Set the Mini App URL to `WEBAPP_URL`.
4. Set `BOT_USERNAME` to the bot username without `@`.

## Crypto Pay setup

The official Crypto Pay API documentation updated on March 19, 2026 describes invoice creation, `invoice_paid` webhooks, and transfers:
- https://help.send.tg/en/articles/10279948-crypto-pay-api

Set webhook URL in Crypto Pay to:

```text
https://your-domain.bothost.tech/api/webhooks/crypto-pay
```

And keep:

```env
CRYPTO_PAY_WEBHOOK_PATH=/api/webhooks/crypto-pay
```

## Important note

`DB_PATH` in this project points to a JSON file, not SQLite. For this codebase, use something like `./data/store.json` or `/app/data/store.json`.
