# Деплой PERPL // TELEMETRY

## Архитектура продакшена

```
Neon PostgreSQL  ←──────────────────────────┐
       ↑                                     │
Replit Reserved VM                    Vercel (frontend)
(API Server + Indexer)  ←── fetch ───  React SPA
```

- **Neon** — внешняя PostgreSQL (хранит все on-chain данные)
- **Replit Reserved VM** — Express API + фоновый индексер (работает 24/7)
- **Vercel** — статический фронтенд, обращается к API на Replit

---

## Шаг 1: Neon PostgreSQL

1. Зайди на [neon.tech](https://neon.tech) и создай проект `perpl-telemetry`
2. В дашборде скопируй **Connection String** (формат `postgresql://user:pass@host/db?sslmode=require`)
3. Добавь её в Replit Secrets под именем `DATABASE_URL`
4. Примени схему к Neon:
   ```bash
   pnpm --filter @workspace/db exec drizzle-kit push --force
   ```

---

## Шаг 2: Replit — API-сервер (Reserved VM)

### Переменные окружения в Replit Secrets:
| Ключ | Значение |
|------|---------|
| `DATABASE_URL` | Connection string из Neon |
| `SESSION_SECRET` | Случайная строка 32+ символов |
| `CORS_ORIGINS` | URL твоего Vercel-приложения, например `https://perpl-telemetry.vercel.app` |

### Деплой:
1. В Replit перейди в **Deployments** → **Reserved VM**
2. Убедись что Run command: `pnpm --filter @workspace/api-server run dev`
3. Задеплой — получишь URL вида `https://perpl-telemetry.replit.app`

---

## Шаг 3: Vercel — фронтенд

### Подключение репозитория:
1. Запушь код на GitHub (уже настроено через `brouk16/Perpltelemetry`)
2. Зайди на [vercel.com](https://vercel.com) → **Add New Project**
3. Импортируй репозиторий `brouk16/Perpltelemetry`
4. Vercel автоматически подхватит `vercel.json` из корня

### Переменные окружения в Vercel:
| Ключ | Значение |
|------|---------|
| `VITE_API_BASE` | URL твоего Replit API, например `https://perpl-telemetry.replit.app/api` |

> **Важно**: После того как получишь Vercel URL (`https://perpl-telemetry.vercel.app`),
> добавь его в Replit Secret `CORS_ORIGINS` и перезапусти API-сервер.

### Настройки билда (уже в vercel.json):
- Build Command: `pnpm --filter @workspace/perpl-stats run build:vercel`
- Output Directory: `artifacts/perpl-stats/dist/public`
- Install Command: `pnpm install --frozen-lockfile`

---

## Проверка после деплоя

```bash
# API доступен
curl https://perpl-telemetry.replit.app/api/stats

# Фронт подключён к API
# Открой https://perpl-telemetry.vercel.app — должны загрузиться данные
```
