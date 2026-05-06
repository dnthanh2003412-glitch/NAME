# Dash Notion

Dashboard phan tich du lieu Notion theo thoi gian thuc, toi uu cho whitelist project, co cache cuc bo dang file va sync nen dinh ky.

## Tinh nang chinh

- Doc du lieu Notion bang `NOTION_ACCESS_TOKEN` / `NOTION_TOKEN` (khong bat buoc OAuth flow tren UI).
- Sidebar project tree + whitelist pin/unpin.
- Polling nen voi incremental sync + full-sync checkpoint dinh ky de loai stale/ghost records.
- Realtime progress qua WebSocket, frontend tu refresh report khi sync hoan tat.
- Bo report: Sprint, Productivity, Raw Data, Raw All Projects (whitelist), Burndown, Sync Monitor (Admin).
- Chatbot preview widget qua API `GET /api/chat/config` + `POST /api/chat`.
- Cache cuc bo split-file:
  - `backend/data/cache/*.json`: du lieu theo tung database
  - `backend/data/config.json`: cau hinh chay
  - `backend/data/metadata.json`: sync times, audit, relation cache

## Yeu cau

- Node.js `>=18`
- Notion Integration Token da co quyen doc cac database can dung

## Chay nhanh (local)

```bash
# Cai dependencies backend
cd backend
npm install

# Tao file env
copy .env.example .env

# Chay server
npm start
```

Hoac tu root:

```bash
npm start
```

Mac dinh app chay o `http://localhost:3000`.

## Cau hinh moi truong

`backend/.env`:

```env
# Bat buoc: token Notion (uu tien NOTION_ACCESS_TOKEN)
NOTION_ACCESS_TOKEN=secret_xxx
# NOTION_TOKEN=secret_xxx

# Server
PORT=3000
CORS_ORIGIN=http://localhost:3000
SESSION_SECRET=replace_with_strong_secret

# Polling / Sync
POLLING_INTERVAL=300000
FULL_SYNC_CHECKPOINT_MS=21600000
RAW_FORMAT_CACHE_TTL_MS=120000
RAW_RELATION_RESOLVE_MAX_ROWS=400

# Admin / Sync monitor
ADMIN_MODE=false
SYNC_JOB_TIMEOUT_MS=1800000
SYNC_JOB_RETRY_LIMIT=1
SYNC_MISMATCH_THRESHOLD=0
SYNC_MISMATCH_CONSECUTIVE_LIMIT=2

# Chatbot preview (optional)
CHATBOT_ENABLED=true
AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini

# Data directory (optional)
# DATA_DIR=./data
```

## Whitelist va cache

- File whitelist: `backend/data/priority_projects.json`.
- Poller luon sync ca `selected_databases` va `priority_databases` (whitelist) de giu cache nong.
- Khi pin/unpin whitelist, backend se:
  - cap nhat file whitelist,
  - clear formatted raw cache,
  - kich hoat background warmup de lam moi cache som.

## Scripts huu ich

```bash
# Chay test backend
npm --prefix backend test

# Chay backend o mode watch
npm --prefix backend run dev
```

## Deploy len Render (onrender.com)

### 1) Push code len GitHub

Dam bao ban da push repo nay len GitHub (Render se ket noi vao repo). Neu chua co repo rieng, tao repo moi tren GitHub va push code len.

### 2) Ket noi Render voi repo

Co 2 cach: dung Blueprint (khuyen nghi) hoac tao Web Service thu cong.

#### Cach A: Blueprint (tu dong doc `render.yaml`)

1. Dang nhap Render.
2. Chon **New** -> **Blueprint**.
3. Chon repo GitHub chua code nay.
4. Render se doc `render.yaml` va tao service `notion-dashboard`.
5. Set cac bien moi truong bat buoc (xem muc 4).
6. Deploy.

#### Cach B: Tao Web Service thu cong

1. Dang nhap Render.
2. Chon **New** -> **Web Service**.
3. Chon repo GitHub chua code nay.
4. Cau hinh:
   - Runtime: `Node`
   - Build Command: `cd backend && npm install`
   - Start Command: `cd backend && npm start`
   - Auto-Deploy: On (tuy chon)
5. Set bien moi truong (xem muc 4).
6. Deploy.

### 3) Static frontend

Frontend la static file trong `frontend/public`. Render co the publish static path nay neu deploy theo `render.yaml` (thuoc tinh `staticPublishPath`). Neu deploy thu cong, dam bao file `frontend/public` co san va backend serve dung đường dan public neu can.

### 4) Bien moi truong can thiet tren Render

Set trong Render dashboard (Environment):

Bat buoc:
- `NOTION_ACCESS_TOKEN` (uu tien) hoac `NOTION_TOKEN`
- `SESSION_SECRET` (Render co the tu generate)

Khuyen nghi:
- `CORS_ORIGIN`: dat bang URL production cua Render, vi du `https://your-app.onrender.com`
- `ADMIN_MODE=false` (true neu can Sync Monitor)
- `POLLING_INTERVAL`, `FULL_SYNC_CHECKPOINT_MS` neu can tuning

Optional (neu dung chatbot):
- `CHATBOT_ENABLED=true`
- `AI_API_KEY`
- `AI_BASE_URL` (mac dinh `https://api.openai.com/v1`)
- `AI_MODEL` (vi du `gpt-4o-mini`)

### 5) Luu tru cache (khuyen nghi)

Render free/standard dung filesystem ephemereal, data trong `backend/data` co the bi mat khi redeploy.
Neu can giu cache on dinh:

1. Tao **Persistent Disk** tren Render.
2. Mount vao service (vi du `/data`).
3. Set env `DATA_DIR=/data`.

### 6) Kiem tra sau deploy

1. Mo URL service: `https://your-app.onrender.com`.
2. Kiem tra log service tren Render, dam bao sync Notion chay khong loi.
3. Neu loi CORS, cap nhat `CORS_ORIGIN` theo domain moi.

## Tai lieu noi bo

- `docs/todo_master_plan_2026-02-23.md`
- `docs/audit_sync_uiux_performance_2026-02-23.md`
- `docs/runbook_sync_mismatch_stale.md`
