# Contributing to Sam CodeAI Telegram Bot

Thank you for your interest in contributing to the **Sam CodeAI Telegram Bot**! This project is an autonomous conversational agent designed for deterministic, grounded lead qualification and real-time CRM ingestion.

---

## 🛠 Development Workflow

### 1. Prerequisites
- Node.js >= 20.0.0
- npm / pnpm
- A Telegram Bot Token from [@BotFather](https://t.me/botfather)

### 2. Setup
```bash
# Clone repository
git clone https://github.com/Sam-CodesAI/sam-codeai-telegram-bot.git
cd sam-codeai-telegram-bot

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### 3. Local Verification
```bash
# Typecheck
npm run typecheck

# Build TypeScript
npm run build

# Run Unit Tests
npm test
```

---

## 🚀 Branching & Commit Guidelines

1. **Create a topic branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. **Follow Conventional Commits:**
   - `feat(agent): add multi-language support`
   - `fix(client): resolve rate limiter race condition`
   - `docs(readme): add docker-compose instructions`
3. **Push and Open a Pull Request:**
   Every PR triggers the automated GitHub Actions CI pipeline to verify builds and test coverage.

---

## 📜 Code of Conduct
Please be respectful, collaborative, and uphold high engineering standards. No placeholder code or unverified claims.
