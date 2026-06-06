# AURUM v18 PRO

## Installation

```bash
npm install
cp .env.example .env
# Edite .env avec tes clés API
node server.js
```

## Variables .env

```
TWELVEDATA_KEY=ta_cle_twelvedata
ANTHROPIC_KEY=ta_cle_anthropic
TELEGRAM_TOKEN=token_bot_telegram
TELEGRAM_CHAT_ID=ton_chat_id
```

## Deploiement Railway

1. Va sur railway.app
2. New Project → Deploy from GitHub repo
3. Ajoute les variables d environnement
4. Deploy

## Architecture

- server.js : Serveur principal + cron auto
- src/services/marketService.js : Prix temps reel
- src/services/indicatorService.js : RSI EMA MACD ATR ADX Bollinger
- src/services/aiService.js : Analyse IA Claude
- src/services/telegramService.js : Notifications
- public/index.html : Interface utilisateur
