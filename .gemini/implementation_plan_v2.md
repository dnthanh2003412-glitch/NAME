# 📋 Implementation Plan v2 - Notion Dashboard Enhancement

## 🎯 Mục tiêu tổng quan
Xây dựng một dashboard có thể:
1. **Tạo báo cáo** - Lấy đúng dữ liệu từ các dự án được chọn
2. **Xem Raw Data** - Pre-check data real-time (refresh mỗi 2 phút)
3. **Ẩn/Hiện** - Tùy chỉnh view cho gọn gàng

---

## 📝 Chi tiết các yêu cầu

### 1️⃣ Xóa các mục thừa
**Vấn đề:** Đã mặc định lấy all data rồi → bỏ lựa chọn Select All trong Setup wizard

**Giải pháp:**
- Xóa màn hình Setup wizard (select databases)
- Auto-load tất cả databases khi khởi động
- Giữ nguyên logic backend nhưng auto-select all

**Files cần sửa:**
- `frontend/public/js/auth.js` - Bỏ qua setup, vào thẳng dashboard
- `frontend/public/index.html` - Có thể xóa setup screen nếu không cần

---

### 2️⃣ Phân trang cho Raw Data
**Vấn đề:** Raw data table không có pagination

**Giải pháp:**
- Thêm pagination giống Sprint Report
- Mặc định: 10 items/page
- Options: 10, 20, 50, 100

**Files cần sửa:**
- `frontend/public/js/raw-table.js` - Thêm pagination logic

**UI Elements:**
```
┌────────────────────────────────────────────────┐
│ Hiển thị: [10 ▼] dòng    Showing 1-10 / 3442   │
├────────────────────────────────────────────────┤
│ [Table Content...]                              │
├────────────────────────────────────────────────┤
│        [← Trước]  Page 1 of 345  [Sau →]       │
└────────────────────────────────────────────────┘
```

---

### 3️⃣ Fix hiển thị Assignee (email → tên)
**Vấn đề:** Cột Assignee hiển thị email thay vì tên

**Nguyên nhân phân tích:**
- Notion API trả về `people` property với cả `name` và `email`
- Backend fetcher có thể đang lấy sai field

**Files cần kiểm tra:**
- `backend/src/notion/fetcher.js` - `extractPropertyValue()` cho type `people`
- `backend/src/api/routes.js` - `formatValue()` function

**Giải pháp:**
- Ưu tiên hiển thị `name` thay vì `email`
- Fallback: nếu không có `name` thì mới dùng `email`

---

### 4️⃣ Multi-select dự án + Báo cáo tổng hợp
**Vấn đề:** Hiện tại chỉ chọn được 1 database/project

**Giải pháp:**
1. **Cho phép check nhiều dự án** cùng lúc
2. **Thêm nút "Generate Report"** sau khi chọn
3. **Báo cáo lọc dữ liệu** từ các dự án được tick

**Flow mới:**
```
1. User tick chọn nhiều projects/databases (checkbox)
2. User chọn loại báo cáo từ dropdown
3. User click "Generate Report"
4. Dashboard hiển thị báo cáo với data từ các dự án đã chọn
```

**Files cần sửa:**
- `frontend/public/js/app.js` 
  - Thay đổi logic từ single-select → multi-select
  - Lưu Set của các selected IDs
  - Thêm "Generate Report" button

---

### 5️⃣ Dropdown chọn mẫu báo cáo
**Vấn đề:** Chưa có cách chọn loại báo cáo

**Các mẫu báo cáo (Title - Chi tiết gửi sau):**
1. **Sprint Report** - Báo cáo Sprint (đã có)
2. **Productivity Report** - Báo cáo năng suất (đã có backend)
3. **Raw Data Export** - Xuất dữ liệu thô
4. *(Thêm sau theo yêu cầu)*

**UI Design:**
```
┌─────────────────────────────────────────────────────────────────┐
│  📊 BÁO CÁO                                                     │
│                                                                 │
│  Chọn mẫu báo cáo:                                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Sprint Report                                          ▼  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Chọn dự án:                                                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 🔍 Tìm kiếm dự án...                                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ ☑ Gene (6 databases)                                      │  │
│  │ ☑ CHIBI (9 databases)                                     │  │
│  │ ☐ XANHSM (7 databases)                                    │  │
│  │ ☐ Harry (4 databases)                                     │  │
│  │ ☐ LEGO ZOOM (3 databases)                                 │  │
│  │ ...                                                       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  [Select All] [Deselect All]          Đã chọn: 2 dự án (15 DB) │
│                                                                 │
│                    [ 📄 Tạo Báo Cáo ]                           │
└─────────────────────────────────────────────────────────────────┘
```

**Files cần sửa:**
- `frontend/public/index.html` - Thêm dropdown + button
- `frontend/public/js/app.js` - Logic xử lý
- `frontend/public/css/styles.css` - Styling

---

### 6️⃣ Ẩn cột + Ẩn database + Search sidebar
**Yêu cầu:**
- **Sidebar:** Ẩn database (không xóa, chỉ hide) + Search box
- **Table:** Ẩn cột (không xóa, chỉ hide)

**A. Sidebar Features:**
```
┌─────────────────────────┐
│ 🔍 [Search databases...] │
├─────────────────────────┤
│ ▼ Gene (6)         [👁] │
│   ├ Product        [👁] │
│   ├ Task           [👁] │
│   └ Sprint         [👁] │
│ ▼ CHIBI (9)        [👁] │
│   ...                   │
└─────────────────────────┘
```

**B. Table Column Features:**
```
┌──────────────────────────────────────────────────┐
│ Columns: [✓ Name] [✓ Status] [□ ID] [✓ Date]... │
├──────────────────────────────────────────────────┤
│ Name         | Status    | Date                  │
│ Task 1       | Done      | 2024-01-20           │
└──────────────────────────────────────────────────┘
```

**Files cần sửa:**
- `frontend/public/js/app.js` - Search & visibility toggle
- `frontend/public/js/raw-table.js` - Column visibility
- `frontend/public/css/styles.css` - Styling
- LocalStorage để lưu preferences

---

## 🏗️ Kế hoạch thực hiện (Theo thứ tự)

### Phase 1: Backend Fixes (15 phút)
| Step | Task | File |
|------|------|------|
| 1.1 | Fix Assignee display (email → name) | `fetcher.js`, `routes.js` |

### Phase 2: UI Cleanup (10 phút)
| Step | Task | File |
|------|------|------|
| 2.1 | Bỏ Setup wizard, auto-load all databases | `auth.js` |
| 2.2 | Clean up unused HTML | `index.html` |

### Phase 3: Raw Data Pagination (20 phút)
| Step | Task | File |
|------|------|------|
| 3.1 | Thêm pagination controls | `raw-table.js` |
| 3.2 | Thêm page size selector | `raw-table.js` |
| 3.3 | Style pagination | `styles.css` |

### Phase 4: Multi-select + Report Dropdown (30 phút)
| Step | Task | File |
|------|------|------|
| 4.1 | Refactor sidebar cho multi-select | `app.js` |
| 4.2 | Thêm Report dropdown UI | `index.html`, `styles.css` |
| 4.3 | Thêm "Generate Report" button | `index.html`, `app.js` |
| 4.4 | Logic tạo báo cáo từ multi-select | `app.js` |

### Phase 5: Sidebar Search + Visibility (25 phút)
| Step | Task | File |
|------|------|------|
| 5.1 | Thêm search box vào sidebar | `index.html`, `app.js` |
| 5.2 | Thêm nút ẩn database | `app.js`, `styles.css` |
| 5.3 | Lưu visibility vào localStorage | `app.js` |

### Phase 6: Column Visibility (20 phút)
| Step | Task | File |
|------|------|------|
| 6.1 | Thêm column toggle UI | `raw-table.js` |
| 6.2 | Filter columns khi render | `raw-table.js` |
| 6.3 | Lưu preferences vào localStorage | `raw-table.js` |

### Phase 7: Testing & Polish (15 phút)
| Step | Task | File |
|------|------|------|
| 7.1 | Test full workflow | Browser |
| 7.2 | Fix UI issues | All CSS |
| 7.3 | Responsive check | `styles.css` |

---

## 📐 UI Mockup - Main Dashboard (Sau khi hoàn thành)

```
┌────────────────────────────────────────────────────────────────────────┐
│ Dashboard            ● Connected                                     ⟳  │
├──────────────────────┬─────────────────────────────────────────────────┤
│ 🔍 Search...         │   📊 SELECT REPORT                              │
│                      │   ┌─────────────────────────────────────────┐   │
│ ☑ Gene          [👁] │   │ Sprint Report                       ▼   │   │
│   ├ ☑ Product       │   └─────────────────────────────────────────┘   │
│   ├ ☑ Task          │                                                  │
│   └ ☐ Sprint        │   Selected: Gene, CHIBI (12 databases)           │
│                      │                                                  │
│ ☑ CHIBI         [👁] │   [ 📄 Generate Report ]  [ 📥 Export Raw Data ] │
│   ├ ☑ Product       │                                                  │
│   ├ ☑ Task          │   ═══════════════════════════════════════════    │
│   └ ☑ Sprint        │                                                  │
│                      │   Sprint Report - Gene, CHIBI                   │
│ ☐ XANHSM        [👁] │   ────────────────────────────────────────────  │
│ ☐ Harry         [👁] │   Filters: [Product ▼] [Sprint ▼] [Assignee ▼]  │
│                      │                                                  │
│ [Select All]         │   Hiển thị: [10 ▼] dòng    1-10 / 156 dòng     │
│ [Deselect All]       │   ┌─────────────────────────────────────────────┤
│                      │   │ Product | Sprint | Assignee | Points       │ │
│                      │   ├─────────────────────────────────────────────┤
│                      │   │ Gene    | S1     | Nguyen   | 24           │ │
│                      │   │ CHIBI   | S2     | Tran     | 18           │ │
│                      │   └─────────────────────────────────────────────┤
│                      │        [← Trước]  1/16  [Sau →]                 │
└──────────────────────┴─────────────────────────────────────────────────┘
```

---

## ✅ Các câu hỏi đã được xác nhận

| # | Câu hỏi | Trả lời |
|---|---------|---------|
| 1 | Các mẫu báo cáo | Tạo trước title, chi tiết gửi sau. Có thể mở rộng tương lai |
| 2 | Raw Data Export | **TẤT CẢ** báo cáo và bảng đều có thể xuất Excel/CSV |
| 3 | Ẩn database/column | Có **Lưu cấu hình** + **Reset cấu hình** |
| 4 | Polling interval | Giữ **2 phút** (120000ms) |

---

## 🏗️ Kế hoạch thực hiện (Cập nhật)

### Phase 1: Backend Fixes (15 phút)
| Step | Task | File |
|------|------|------|
| 1.1 | Fix Assignee display (email → name) | `fetcher.js`, `routes.js` |

### Phase 2: UI Cleanup (10 phút)
| Step | Task | File |
|------|------|------|
| 2.1 | Bỏ Setup wizard, auto-load all databases | `auth.js` |
| 2.2 | Clean up unused HTML | `index.html` |

### Phase 3: Raw Data Pagination (20 phút)
| Step | Task | File |
|------|------|------|
| 3.1 | Thêm pagination controls | `raw-table.js` |
| 3.2 | Thêm page size selector (10/20/50/100) | `raw-table.js` |
| 3.3 | Style pagination | `styles.css` |

### Phase 4: Multi-select + Report Dropdown (35 phút)
| Step | Task | File |
|------|------|------|
| 4.1 | Refactor sidebar cho multi-select | `app.js` |
| 4.2 | Thêm Report dropdown UI + Search box | `index.html`, `styles.css` |
| 4.3 | Thêm "Generate Report" button | `index.html`, `app.js` |
| 4.4 | Logic tạo báo cáo từ multi-select | `app.js` |

### Phase 5: Sidebar Search + Visibility + Save/Reset (30 phút)
| Step | Task | File |
|------|------|------|
| 5.1 | Thêm search box vào sidebar | `index.html`, `app.js` |
| 5.2 | Thêm nút ẩn database (eye icon) | `app.js`, `styles.css` |
| 5.3 | **Lưu cấu hình** vào localStorage | `app.js` |
| 5.4 | **Reset cấu hình** button | `app.js` |

### Phase 6: Column Visibility + Save/Reset (25 phút)
| Step | Task | File |
|------|------|------|
| 6.1 | Thêm column toggle UI | `raw-table.js` |
| 6.2 | Filter columns khi render | `raw-table.js` |
| 6.3 | **Lưu preferences** vào localStorage | `raw-table.js` |
| 6.4 | **Reset columns** button | `raw-table.js` |

### Phase 7: Excel/CSV Export (25 phút) ⭐ NEW
| Step | Task | File |
|------|------|------|
| 7.1 | Thêm Export button cho Raw Data | `raw-table.js` |
| 7.2 | Thêm Export button cho Reports | `app.js` |
| 7.3 | Logic xuất CSV | `export.js` (new) |
| 7.4 | Logic xuất Excel (xlsx) | `export.js` |

### Phase 8: Testing & Polish (15 phút)
| Step | Task | File |
|------|------|------|
| 8.1 | Test full workflow | Browser |
| 8.2 | Fix UI issues | All CSS |
| 8.3 | Responsive check | `styles.css` |

---

## 📊 Các mẫu báo cáo (Placeholder - Chi tiết gửi sau)

| # | Report Name | Status | Mô tả |
|---|-------------|--------|-------|
| 1 | Sprint Report | ✅ Đã có | Báo cáo task points theo Sprint |
| 2 | Productivity Report | ✅ Backend có | Báo cáo năng suất |
| 3 | Raw Data Export | 🔧 Cần thêm | Xuất dữ liệu thô |
| 4 | *Report 4 (TBD)* | 📋 Placeholder | *Chi tiết gửi sau* |
| 5 | *Report 5 (TBD)* | 📋 Placeholder | *Chi tiết gửi sau* |

---

## 🎯 Tổng thời gian ước tính: ~2 giờ 55 phút

```
Phase 1: Backend Fixes              → 15 phút
Phase 2: UI Cleanup                 → 10 phút  
Phase 3: Raw Data Pagination        → 20 phút
Phase 4: Multi-select + Report      → 35 phút
Phase 5: Sidebar + Save/Reset       → 30 phút
Phase 6: Column Visibility          → 25 phút
Phase 7: Excel/CSV Export           → 25 phút ⭐ NEW
Phase 8: Testing & Polish           → 15 phút
─────────────────────────────────────────────────
                        Tổng:      ~2 giờ 55 phút
```

---

## ✅ PLAN ĐÃ ĐƯỢC XÁC NHẬN - SẴN SÀNG THỰC HIỆN!

Reply "OK" hoặc "Bắt đầu" để tôi implement theo từng Phase.
