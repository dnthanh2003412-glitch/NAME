# Dashboard Báo Cáo Notion Real-time - Kế Hoạch Triển Khai

Xây dựng ứng dụng web local để lấy dữ liệu từ Notion databases với cập nhật real-time, thay thế hoàn toàn n8n. Hệ thống sẽ xử lý pagination đúng cách, cache dữ liệu local, và cung cấp dashboard hiện đại.

## Cần Xem Xét

> [!IMPORTANT]
> **Xác Thực Notion OAuth - Đơn Giản Hóa**
> Thay vì phải lấy token và database IDs thủ công, ứng dụng sẽ:
> 1. **Lần đầu sử dụng**: Click nút "Connect Notion" → Login Notion → Chọn workspace → Xong!
> 2. **Auto-discover databases**: App tự động liệt kê TẤT CẢ databases bạn có quyền
> 3. **Chọn databases qua UI**: Tick chọn databases nào muốn dùng cho báo cáo
> 4. **Không cần IT**: User có full access là tự connect được

> [!NOTE]
> **Hệ Thống Báo Cáo Linh Hoạt**
> - Kiến trúc modular hỗ trợ **10+ loại báo cáo** dễ dàng
> - Mỗi báo cáo là 1 plugin độc lập
> - Trước mắt build 4-5 báo cáo chính, sau này thêm dễ dàng
> - Backend poll Notion **mỗi 2 phút** (có thể điều chỉnh)

## Các Thay Đổi Đề Xuất

### Backend Service (Node.js)

#### [NEW] [package.json](file:///d:/Web%20edit/notion-dashboard/backend/package.json)

Cấu hình Node.js project với dependencies:
- `@notionhq/client` - Notion SDK chính thức
- `express` - Web server framework
- `ws` - WebSocket cho real-time updates
- `better-sqlite3` - SQLite database để cache
- `node-cron` - Scheduled polling
- `dotenv` - Environment configuration

---

#### [NEW] [.env.example](file:///d:/Web%20edit/notion-dashboard/backend/.env.example)

Template biến môi trường:
- `NOTION_CLIENT_ID` - Tạo từ Notion integration settings (public)
- `NOTION_CLIENT_SECRET` - Secret từ Notion integration (private)
- `NOTION_REDIRECT_URI` - Callback URL sau khi OAuth (http://localhost:3000/auth/callback)
- `SESSION_SECRET` - Secret để encrypt session
- `POLLING_INTERVAL` - Thời gian polling (mặc định 120000ms = 2 phút)
- `PORT` - Cổng server (mặc định 3000)

---

#### [NEW] [src/auth/oauth.js](file:///d:/Web%20edit/notion-dashboard/backend/src/auth/oauth.js)

Notion OAuth flow handler:
- `getAuthorizationUrl()` - Tạo URL để redirect user tới Notion login
- `handleCallback()` - Xử lý callback từ Notion, đổi code lấy access token
- Lưu access token vào session (encrypted)
- Refresh token khi hết hạn

---

#### [NEW] [src/notion/client.js](file:///d:/Web%20edit/notion-dashboard/backend/src/notion/client.js)

Notion API client với **xử lý pagination đầy đủ**:
- Khởi tạo Notion SDK client với token từ session
- Hàm `getAllPages()` fetch tất cả pages qua `start_cursor` đệ quy
- Xử lý cờ `has_more` đúng cách để không bỏ sót data
- Rate limiting tránh API throttling (tối đa 3 requests/giây)
- Error handling và retry logic

---

#### [NEW] [src/notion/discovery.js](file:///d:/Web%20edit/notion-dashboard/backend/src/notion/discovery.js)

Auto-discover Notion databases:
- `searchAllDatabases()` - Dùng Search API để list tất cả databases
- Hiển thị tên và thông tin database cho user chọn
- Lưu danh sách databases đã chọn vào config
- Validate quyền access cho mỗi database

---

#### [NEW] [src/notion/fetcher.js](file:///d:/Web%20edit/notion-dashboard/backend/src/notion/fetcher.js)

Điều phối lấy dữ liệu:
- `fetchAllData()` - Lấy từ TẤT CẢ databases đã chọn
- Fetch song song để tăng tốc độ
- Transform dữ liệu từ format Notion sang app format
- Normalize data structure (chuẩn hóa fields)
- Validation đảm bảo data đầy đủ
- Logging chi tiết (hiển thị số lượng records từng database)

---

#### [NEW] [src/database/db.js](file:///d:/Web%20edit/notion-dashboard/backend/src/database/db.js)

Quản lý SQLite database:
- Khởi tạo SQLite database với tables cho sprints, tasks, products
- `saveData()` - Cache dữ liệu Notion đã fetch
- `getData()` - Lấy cached data cho API endpoints
- `getLastUpdate()` - Track thời điểm refresh data cuối
- Hỗ trợ transaction đảm bảo data consistency

---

#### [NEW] [src/reports/base-report.js](file:///d:/Web%20edit/notion-dashboard/backend/src/reports/base-report.js)

Base class cho tất cả reports:
- Abstract class với interface chung
- `calculate()` - Tính toán metrics từ raw data
- `format()` - Format output cho frontend
- `validate()` - Validate data trước khi tính
- Dễ dàng extend để tạo report mới

---

#### [NEW] [src/reports/sprint-report.js](file:///d:/Web%20edit/notion-dashboard/backend/src/reports/sprint-report.js)

Báo Cáo Sprint (Report 1):
- Task points theo Sprint (confirmed/unconfirmed)
- Group by Sprint và Assignee
- Hiển thị Sprint name thay vì ID

---

#### [NEW] [src/reports/productivity-report.js](file:///d:/Web%20edit/notion-dashboard/backend/src/reports/productivity-report.js)

Báo Cáo Năng Suất (Report 2):
- Năng suất theo assignee
- So sánh actual vs expected hours
- Percentage output

---

#### [NEW] [src/reports/raw-tasks-report.js](file:///d:/Web%20edit/notion-dashboard/backend/src/reports/raw-tasks-report.js)

Báo Cáo Raw Tasks (Report 3):
- Tất cả tasks với chi tiết
- Status, assignee, dates, etc.
- Export-friendly format

---

#### [NEW] [src/reports/index.js](file:///d:/Web%20edit/notion-dashboard/backend/src/reports/index.js)

Report registry:
- Register tất cả reports
- `getReport(reportName)` - Lấy report instance
- `getAllReports()` - List tất cả reports có sẵn
- Dễ thêm reports mới (chỉ cần import và register)

---

#### [NEW] [src/api/routes.js](file:///d:/Web%20edit/notion-dashboard/backend/src/api/routes.js)

REST API endpoints:
- `GET /auth/login` - Redirect tới Notion OAuth
- `GET /auth/callback` - Xử lý OAuth callback
- `GET /auth/status` - Check authentication status
- `GET /api/databases` - List databases có sẵn
- `POST /api/databases/select` - Chọn databases để dùng
- `GET /api/reports` - List tất cả reports có sẵn
- `GET /api/reports/:reportName` - Lấy data của 1 report cụ thể
- `GET /api/status` - Server health và thời gian update cuối
- CORS enabled cho local development

---

#### [NEW] [src/websocket/server.js](file:///d:/Web%20edit/notion-dashboard/backend/src/websocket/server.js)

WebSocket server cho real-time updates:
- Broadcast updates tới tất cả clients khi data refresh
- Gửi events `data-updated` với timestamp
- Quản lý connection
- Heartbeat phát hiện clients bị disconnect

---

#### [NEW] [src/scheduler/poller.js](file:///d:/Web%20edit/notion-dashboard/backend/src/scheduler/poller.js)

Service polling theo lịch:
- Chạy mỗi 2 phút (có thể điều chỉnh)
- Fetch dữ liệu mới nhất từ Notion
- Cập nhật SQLite cache
- Thông báo WebSocket clients có data mới
- Error handling tránh crash

---

#### [NEW] [src/index.js](file:///d:/Web%20edit/notion-dashboard/backend/src/index.js)

Entry point server chính:
- Khởi tạo Express server
- Setup API routes
- Khởi tạo WebSocket server
- Start scheduled poller
- Graceful shutdown handling

---

### Frontend Dashboard (Modern Web)

#### [NEW] [public/index.html](file:///d:/Web%20edit/notion-dashboard/frontend/public/index.html)

Cấu trúc HTML dashboard chính:
- Landing page với nút "Connect Notion" (nếu chưa auth)
- Setup wizard chọn databases (lần đầu)
- Dashboard chính với sidebar navigation
- Dynamic report sections (load theo report được chọn)
- Chỉ báo trạng thái real-time
- Responsive layout
- Loading và error states

---

#### [NEW] [public/css/styles.css](file:///d:/Web%20edit/notion-dashboard/frontend/public/css/styles.css)

Styling CSS hiện đại, cao cấp:
- Dark mode design với accent colors sống động
- Glassmorphism effects cho cards
- Smooth animations và transitions
- Responsive layout (mobile-first)
- Custom scrollbars và hover effects
- Typography chuyên nghiệp (Google Fonts)

---

#### [NEW] [public/js/auth.js](file:///d:/Web%20edit/notion-dashboard/frontend/public/js/auth.js)

Authentication flow:
- Check auth status khi load page
- Handle OAuth login flow
- Redirect tới setup nếu chưa chọn databases
- Session management

---

#### [NEW] [public/js/setup.js](file:///d:/Web%20edit/notion-dashboard/frontend/public/js/setup.js)

Setup wizard:
- Hiển thị danh sách databases từ API
- UI cho phép user tick chọn databases
- Save configuration
- Redirect tới dashboard sau khi setup

---

#### [NEW] [public/js/app.js](file:///d:/Web%20edit/notion-dashboard/frontend/public/js/app.js)

Logic ứng dụng chính:
- Load danh sách reports từ API
- Render sidebar navigation
- Fetch data cho report hiện tại
- Khởi tạo Chart.js visualizations
- WebSocket connection cho real-time updates
- Auto-refresh UI khi có data mới
- Error handling và retry logic

---

#### [NEW] [public/js/charts.js](file:///d:/Web%20edit/notion-dashboard/frontend/public/js/charts.js)

Module render biểu đồ:
- Biểu đồ cột Sprint report (confirmed vs unconfirmed points)
- Biểu đồ tròn Productivity (theo assignee)
- Color schemes chuyên nghiệp
- Interactive tooltips
- Responsive charts

---

#### [NEW] [public/js/tables.js](file:///d:/Web%20edit/notion-dashboard/frontend/public/js/tables.js)

Render bảng dữ liệu:
- Bảng raw tasks với sorting và filtering
- Status badges với màu sắc
- Pagination cho datasets lớn
- Chức năng export to CSV
- Khả năng search

---

### Cấu Hình & Tài Liệu

#### [NEW] [README.md](file:///d:/Web%20edit/notion-dashboard/README.md)

Hướng dẫn setup và sử dụng đầy đủ:
- Yêu cầu (phiên bản Node.js)
- Các bước cài đặt
- Hướng dẫn setup Notion integration
- Cách lấy Database IDs
- Chạy ứng dụng local
- Troubleshooting các vấn đề thường gặp

---

#### [NEW] [.gitignore](file:///d:/Web%20edit/notion-dashboard/.gitignore)

File Git ignore:
- `node_modules/`
- `.env` (dữ liệu nhạy cảm)
- `*.db` (SQLite database files)
- `.DS_Store`, logs, etc.

## Kế Hoạch Kiểm Tra

### Tests Tự Động

```bash
# Cài đặt dependencies
cd d:/Web edit/notion-dashboard/backend
npm install

# Cấu hình environment
cp .env.example .env
# (Chỉnh sửa .env với Notion credentials của bạn)

# Chạy backend server
npm start

# Terminal khác, serve frontend
cd ../frontend
npx serve public -p 3001
```

### Kiểm Tra Thủ Công

1. **Test OAuth Flow**: 
   - Click "Connect Notion" → Redirect đúng
   - Login Notion thành công
   - Callback về app với token
   
2. **Test Database Discovery**:
   - Hiển thị danh sách databases từ workspace
   - Chọn databases và save thành công
   
3. **Test Kết Nối**: Xác nhận backend fetch data từ databases đã chọn

4. **Test Pagination**: Kiểm tra logs hiển thị số lượng records đúng (khớp với Notion)

5. **Test Real-time**: Mở dashboard, đợi chu kỳ polling 2 phút, xác nhận UI tự động update

6. **Test Reports**: 
   - Báo cáo Sprint hiển thị task points chính xác
   - Biểu đồ Productivity render đúng
   - Bảng raw tasks hiển thị đầy đủ dữ liệu
   - Chuyển đổi giữa các reports smooth
   
7. **Test Error Handling**: Tắt backend, xác nhận frontend hiển thị lỗi connection và reconnect

---

**Lợi ích của approach mới:**
- ✅ **OAuth login đơn giản** - User tự connect, không cần IT
- ✅ **Auto-discover databases** - Không cần copy/paste IDs thủ công
- ✅ **Modular reports** - Dễ dàng thêm 10+ loại báo cáo
- ✅ **Không phụ thuộc n8n** - Pure web application
- ✅ **Đảm bảo pagination** - Fetch TẤT CẢ data
- ✅ **Real-time updates** - WebSocket tự động refresh
- ✅ **Loading nhanh** - SQLite cache
- ✅ **Dễ debug** - Detailed logging
- ✅ **UI hiện đại** - Professional dashboard
- ✅ **Local first** - Deploy sau khi test kỹ
