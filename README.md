# Dash Notion

Dashboard phân tích dữ liệu Notion theo thời gian thực, tối ưu cho whitelist project, có cache cục bộ dạng file và sync nền định kỳ.

## Tính năng chính

- Đọc dữ liệu Notion bằng `NOTION_ACCESS_TOKEN` / `NOTION_TOKEN` (không bắt buộc OAuth flow trên UI).
- Sidebar project tree + whitelist pin/unpin.
- Polling nền với incremental sync + full-sync checkpoint định kỳ để loại stale/ghost records.
- Realtime progress qua WebSocket, frontend tự refresh report khi sync hoàn tất.
- Bộ report: Sprint, Productivity, Raw Data, Raw All Projects (whitelist), Burndown, Sync Monitor (Admin).
- Chatbot preview widget qua API `GET /api/chat/config` + `POST /api/chat`.
- Cache cục bộ split-file:
  - `backend/data/cache/*.json`: dữ liệu theo từng database
  - `backend/data/config.json`: cấu hình chạy
  - `backend/data/metadata.json`: sync times, audit, relation cache

## Yêu cầu

- Node.js `>=18`
- Notion Integration Token đã có quyền đọc các database cần dùng

## Chạy nhanh (local)

```bash
# Cài dependencies backend
cd backend
npm install

# Tạo file env
copy .env.example .env

# Chạy server
npm start
```

Hoặc từ root:

```bash
npm start
```

Mặc định app chạy ở `http://localhost:3000`.

## Cấu hình môi trường

`backend/.env`:

```env
# Bắt buộc: token Notion (ưu tiên NOTION_ACCESS_TOKEN)
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

## Whitelist và cache

- File whitelist: `backend/data/priority_projects.json`.
- Poller luôn sync cả `selected_databases` và `priority_databases` (whitelist) để giữ cache nóng.
- Khi pin/unpin whitelist, backend sẽ:
  - cập nhật file whitelist,
  - clear formatted raw cache,
  - kích hoạt background warmup để làm mới cache sớm.

## Scripts hữu ích

```bash
# Chạy test backend
npm --prefix backend test

# Chạy backend ở mode watch
npm --prefix backend run dev
```

## Deploy lên Render (onrender.com)

### 1) Push code lên GitHub

Đảm bảo bạn đã push repo này lên GitHub (Render sẽ kết nối vào repo). Nếu chưa có repo riêng, tạo repo mới trên GitHub và push code lên.

### 2) Kết nối Render với repo

Có 2 cách: dùng Blueprint (khuyến nghị) hoặc tạo Web Service thủ công.

#### Cách A: Blueprint (tự động đọc `render.yaml`)

1. Đăng nhập Render.
2. Chọn **New** -> **Blueprint**.
3. Chọn repo GitHub chứa code này.
4. Render sẽ đọc `render.yaml` và tạo service `notion-dashboard`.
5. Set các biến môi trường bắt buộc (xem mục 4).
6. Deploy.

#### Cách B: Tạo Web Service thủ công

1. Đăng nhập Render.
2. Chọn **New** -> **Web Service**.
3. Chọn repo GitHub chứa code này.
4. Cấu hình:
   - Runtime: `Node`
   - Build Command: `cd backend && npm install`
   - Start Command: `cd backend && npm start`
   - Auto-Deploy: On (tùy chọn)
5. Set biến môi trường (xem mục 4).
6. Deploy.

### 3) Static frontend

Frontend là static file trong `frontend/public`. Render có thể publish static path này nếu deploy theo `render.yaml` (thuộc tính `staticPublishPath`). Nếu deploy thủ công, đảm bảo file `frontend/public` có sẵn và backend serve đúng đường dẫn public nếu cần.

### 4) Biến môi trường cần thiết trên Render

Set trong Render dashboard (Environment):

Bắt buộc:
- `NOTION_ACCESS_TOKEN` (ưu tiên) hoặc `NOTION_TOKEN`
- `SESSION_SECRET` (Render có thể tự generate)

Khuyến nghị:
- `CORS_ORIGIN`: đặt bằng URL production của Render, ví dụ `https://your-app.onrender.com`
- `ADMIN_MODE=false` (true nếu cần Sync Monitor)
- `POLLING_INTERVAL`, `FULL_SYNC_CHECKPOINT_MS` nếu cần tuning

Optional (nếu dùng chatbot):
- `CHATBOT_ENABLED=true`
- `AI_API_KEY`
- `AI_BASE_URL` (mặc định `https://api.openai.com/v1`)
- `AI_MODEL` (ví dụ `gpt-4o-mini`)

### 5) Lưu trữ cache (khuyến nghị)

Render free/standard dùng filesystem ephemeral, data trong `backend/data` có thể bị mất khi redeploy.
Nếu cần giữ cache ổn định:

1. Tạo **Persistent Disk** trên Render.
2. Mount vào service (ví dụ `/data`).
3. Set env `DATA_DIR=/data`.

### 6) Kiểm tra sau deploy

1. Mở URL service: `https://your-app.onrender.com`.
2. Kiểm tra log service trên Render, đảm bảo sync Notion chạy không lỗi.
3. Nếu lỗi CORS, cập nhật `CORS_ORIGIN` theo domain mới.

## Tài liệu nội bộ

- `docs/todo_master_plan_2026-02-23.md`
- `docs/audit_sync_uiux_performance_2026-02-23.md`
- `docs/runbook_sync_mismatch_stale.md`
