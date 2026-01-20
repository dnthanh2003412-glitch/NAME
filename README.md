# Notion Dashboard - Phân Tích Real-time

Ứng dụng web hiện đại để phân tích dữ liệu Notion real-time với OAuth, tự động polling và giao diện đẹp mắt.

## ✨ Tính Năng

- 🔐 **Đăng nhập OAuth đơn giản** - Kết nối Notion workspace chỉ với 1 click
- 🔍 **Tự động tìm Databases** - Tự động liệt kê tất cả databases có quyền truy cập
- 📊 **Nhiều loại báo cáo** - Báo cáo Sprint, năng suất, dữ liệu thô
- 🔄 **Cập nhật Real-time** - WebSocket tự động refresh data mỗi 2 phút
- 💾 **Cache Local** - SQLite database để load nhanh
- 🎨 **Giao diện hiện đại** - Dark theme với glassmorphism và animations mượt
- 📱 **Responsive** - Hoạt động tốt trên desktop, tablet, mobile

## 📋 Yêu Cầu

- Node.js v18+ đã cài đặt
- Notion workspace với quyền admin
- Notion Integration đã tạo (xem hướng dẫn bên dưới)

## 🚀 Hướng Dẫn Nhanh

### 1. Tạo Notion Integration

1. Truy cập https://www.notion.so/my-integrations
2. Click "+ New integration"
3. Điền thông tin:
   - Name: `Tên Dashboard của bạn`
   - Associated workspace: Chọn workspace của bạn
   - Type: Internal Integration
4. Click "Submit"
5. Copy **Internal Integration Token** (sẽ cần dùng)
6. Trong Capabilities, đảm bảo các quyền sau được bật:
   - Read content
   - No user information needed
7. Click "Save"

### 2. Lấy OAuth Credentials

1. Trong integration settings, kéo xuống "OAuth Domain & URIs"
2. Thêm Redirect URI: `http://localhost:3000/auth/callback`
3. Copy:
   - **OAuth client ID**
   - **OAuth client secret**

### 3. Share Databases với Integration

1. Mở từng Notion database bạn muốn theo dõi
2. Click "..." (ba chấm) → "Connections" → "+ Add connections"
3. Chọn tên integration của bạn
4. Lặp lại cho tất cả databases

### 4. Cài Đặt & Cấu Hình

```bash
# Di chuyển vào thư mục backend
cd backend

# Cài đặt dependencies
npm install

# Tạo file .env
copy .env.example .env

# Chỉnh sửa .env với thông tin của bạn
notepad .env
```

Cập nhật `.env` với các giá trị của bạn:
```env
NOTION_CLIENT_ID=oauth_client_id_cua_ban
NOTION_CLIENT_SECRET=oauth_client_secret_cua_ban
NOTION_REDIRECT_URI=http://localhost:3000/auth/callback
SESSION_SECRET=chuoi_bi_mat_ngau_nhien_thay_doi_nay
PORT=3000
POLLING_INTERVAL=120000
```

### 5. Chạy Ứng Dụng

```bash
npm start
```

Bạn sẽ thấy:
```
✅ Notion Dashboard đang chạy!
📡 Backend API: http://localhost:3000
🎨 Frontend: http://localhost:3000
🔌 WebSocket: ws://localhost:3000
🔄 Polling: 120000ms
```

### 6. Kết Nối & Sử Dụng

1. Mở trình duyệt: **http://localhost:3000**
2. Click "Connect Notion"
3. Đăng nhập Notion và authorize
4. Chọn databases muốn theo dõi
5. Click "Save & Continue"
6. Chọn một báo cáo từ sidebar!

## 📊 Các Báo Cáo Có Sẵn

### Báo Cáo Sprint
- Task points theo Sprint và Assignee
- Phân loại Confirmed vs Unconfirmed
- Biểu đồ cột + bảng chi tiết

### Báo Cáo Năng Suất
- Số giờ thực tế vs dự kiến theo assignee
- Tính toán % năng suất
- Biểu đồ tròn (doughnut chart)

### Báo Cáo Tasks Thô
- Danh sách đầy đủ tất cả tasks
- Tất cả thông tin và properties
- Export sang CSV

## 🔧 Cấu Hình

### Khoảng Thời Gian Polling

Thay đổi tần suất lấy dữ liệu (đơn vị: milliseconds):
```env
POLLING_INTERVAL=120000  # 2 phút (mặc định)
POLLING_INTERVAL=300000  # 5 phút
POLLING_INTERVAL=60000   # 1 phút
```

### Đường Dẫn Database

Thay đổi vị trí SQLite database:
```env
DB_PATH=./data/cache.db  # Mặc định
DB_PATH=C:/MyData/notion-cache.db  # Đường dẫn tùy chỉnh
```

## 🛠️ Development

### Cấu Trúc Project

```
notion-dashboard/
├── backend/
│   ├── src/
│   │   ├── auth/          # Xử lý OAuth
│   │   ├── notion/        # Notion API client
│   │   ├── database/      # SQLite caching
│   │   ├── reports/       # Các module báo cáo
│   │   ├── api/           # REST endpoints
│   │   ├── websocket/     # Real-time updates
│   │   ├── scheduler/     # Polling service
│   │   └── index.js       # Entry chính
│   ├── package.json
│   └── .env
├── frontend/
│   └── public/
│       ├── index.html
│       ├── css/           # Styles
│       └── js/            # App logic
└── README.md
```

### Thêm Báo Cáo Mới

1. Tạo report class mới trong `backend/src/reports/`:
```javascript
import { BaseReport } from './base-report.js';

export class BaoCaoMoi extends BaseReport {
  constructor() {
    super('bao-cao-moi', 'Mô Tả Báo Cáo');
  }

  calculate(rawData) {
    // Logic tính toán của bạn
    return result;
  }
}
```

2. Đăng ký trong `backend/src/reports/index.js`:
```javascript
import { BaoCaoMoi } from './bao-cao-moi.js';
// ...
this.register(new BaoCaoMoi());
```

3. Thêm giao diện render trong `app.js` và `charts.js`

## 🐛 Khắc Phục Sự Cố

### Backend không chạy được
- Kiểm tra Node.js version: `node --version` (cần 18+)
- Xác nhận file `.env` tồn tại và có giá trị đúng
- Kiểm tra port 3000 chưa được sử dụng

### OAuth không hoạt động
- Xác nhận Redirect URI khớp chính xác: `http://localhost:3000/auth/callback`
- Kiểm tra OAuth credentials đúng
- Đảm bảo integration đã được kết nối với databases

### Không có dữ liệu hiển thị
- Xác nhận databases đã được share với integration
- Kiểm tra backend logs để tìm lỗi
- Kiểm tra polling đang chạy (logs mỗi 2 phút)
- Thử click nút refresh trong dashboard

### WebSocket bị ngắt kết nối
- Việc reconnect sau vài phút là bình thường
- Kiểm tra backend vẫn đang chạy
- Xác nhận không có firewall chặn WebSocket

## 📝 License

MIT

## 🤝 Hỗ Trợ

Nếu có vấn đề, hãy kiểm tra backend logs để xem thông báo lỗi chi tiết.

Phân tích vui vẻ! 📊✨
