export const SENIORITY_MAPPING = {
    // Dưới 2 năm
    "Đỗ Quốc Huy": "Dưới 2 năm",
    "Hà Thị Mai": "Dưới 2 năm",
    "Nguyễn Bích Ngọc": "Dưới 2 năm",
    "Lê Hoàng Quốc Anh": "Dưới 2 năm",
    "Đinh Trí Bảo Anh": "Dưới 2 năm",
    "Ngô Nguyễn Đình Tuấn Minh": "Dưới 2 năm",
    "Hoàng Việt Linh": "Dưới 2 năm",
    "Đoàn Trung Kiên": "Dưới 2 năm",
    "Quách Thị Yến Nhi": "Dưới 2 năm",
    "Vũ Hoàng An": "Dưới 2 năm",

    // Từ 2 - 3.5 năm
    "Lê Nhật Minh": "Từ 2 - 3.5 năm",
    "Nguyễn Thùy Linh": "Từ 2 - 3.5 năm",
    "Trương Phú Miên Quỳnh": "Từ 2 - 3.5 năm",
    "Trần Thị Hồng Nhung": "Từ 2 - 3.5 năm",
    "Nguyễn Khoa Diệu Hằng": "Từ 2 - 3.5 năm",
    "Cao Minh Khôi": "Từ 2 - 3.5 năm",
    "Nguyễn Xuân Yến": "Từ 2 - 3.5 năm",
    "Nguyễn Thị Hoàng My": "Từ 2 - 3.5 năm",
    "Nguyễn Trường Phúc": "Từ 2 - 3.5 năm",
    "Hoàng Nguyễn Minh Thi": "Từ 2 - 3.5 năm",
    "Nguyễn Nhật Hưng": "Từ 2 - 3.5 năm",
    "Bùi Thị Giang": "Từ 2 - 3.5 năm",
    "Nguyễn Gia Lộc": "Từ 2 - 3.5 năm",
    "Lê Văn Ngoan": "Từ 2 - 3.5 năm",

    // Trên 3.5 năm
    "Nguyễn Thị Mỹ Khanh": "Trên 3.5 năm",
    "Lường Thanh Bình": "Trên 3.5 năm",
    "Trần Thị Thanh Vân": "Trên 3.5 năm",
    "Trịnh Tường Lê": "Trên 3.5 năm",
    "Đỗ Thành Trung": "Trên 3.5 năm",
    "Nguyễn Thị Thanh": "Trên 3.5 năm",
    "Nguyễn Thị Hòa": "Trên 3.5 năm",
    "Hà Huy Hoàng": "Trên 3.5 năm",
    "Đoàn Anh Kiệt": "Trên 3.5 năm",
    "Trần Xuân Hòa": "Trên 3.5 năm"
};

// Map Notion short names to full names
export const NAME_ALIAS_MAPPING = {
    "Huy Đỗ": "Đỗ Quốc Huy",
    "Mai Hà": "Hà Thị Mai",
    "Ngọc Nguyễn": "Nguyễn Bích Ngọc",
    "Quốc Anh": "Lê Hoàng Quốc Anh",
    "Bảo Anh": "Đinh Trí Bảo Anh",
    "Minh Ngô": "Ngô Nguyễn Đình Tuấn Minh",
    "Linh Hoàng": "Hoàng Việt Linh",
    "Kiên Đoàn": "Đoàn Trung Kiên",
    "Nhi Quach": "Quách Thị Yến Nhi",
    "An Vu": "Vũ Hoàng An",
    "Minh Lê": "Lê Nhật Minh",
    "Linh Nguyễn": "Nguyễn Thùy Linh",
    "Quỳnh Trương": "Trương Phú Miên Quỳnh",
    "Nhung Trần": "Trần Thị Hồng Nhung",
    "Hằng Nguyễn": "Nguyễn Khoa Diệu Hằng",
    "Khôi Cao": "Cao Minh Khôi",
    "Yến Nguyễn": "Nguyễn Xuân Yến",
    "My Nguyễn": "Nguyễn Thị Hoàng My",
    "Phúc Nguyễn": "Nguyễn Trường Phúc",
    "Thi Hoàng": "Hoàng Nguyễn Minh Thi",
    "Hưng Nguyễn": "Nguyễn Nhật Hưng",
    "Giang Bùi": "Bùi Thị Giang",
    "Lộc Nguyễn": "Nguyễn Gia Lộc",
    "Khanh Nguyễn": "Nguyễn Thị Mỹ Khanh",
    "Bình Lường": "Lường Thanh Bình",
    "Vân Trần": "Trần Thị Thanh Vân",
    "Lê Trịnh": "Trịnh Tường Lê",
    "Trung Đỗ": "Đỗ Thành Trung",
    "Thanh Nguyễn": "Nguyễn Thị Thanh",
    "Hòa Nguyễn": "Nguyễn Thị Hòa",
    "Hoàng Hà": "Hà Huy Hoàng",
    "Kiệt Đoàn": "Đoàn Anh Kiệt",
    "Hòa Trần": "Trần Xuân Hòa"
};

export const KPI_MAPPING = {
    "Dưới 2 năm": 6.30,
    "Từ 2 - 3.5 năm": 7.83,
    "Trên 3.5 năm": 9.46
};

export const PRODUCT_TYPE_MAPPING = {
    "Turnaround": "Chuyên môn",
    "Rigging": "Chuyên môn",
    "Keyframe": "Chuyên môn",
    "Inbetween": "Chuyên môn",
    "Rough": "Chuyên môn",
    "Tiedown": "Chuyên môn",
    "Clean up": "Chuyên môn",
    "Color": "Chuyên môn",
    "Cut-out": "Chuyên môn",
    "FX": "Chuyên môn",
    "Storyboard": "Chuyên môn",
    "Special pose": "Chuyên môn",
    "Layout": "Chuyên môn",
    "Background": "Chuyên môn",
    "Prop": "Chuyên môn",
    "Comp": "Chuyên môn",
    "Script": "Chuyên môn",
    "Char design": "Chuyên môn",
    // Non-Specialized
    "Họp dự án": "Họp dự án",
    "Lead": "Lead",
    "Phát sinh CM": "Phát sinh chuyên môn",
    "Khác": "Khác"
};

export const COLUMNS = [
    { id: 'stt', name: 'STT' },
    { id: 'fullName', name: 'Tên nhân sự' },
    { id: 'seniority', name: 'Nhóm thâm niên' },
    { id: 'productivityReq', name: 'Năng suất yêu cầu' },
    { id: 'standardDays', name: 'Số công chuẩn' }, // Input
    { id: 'actualDays', name: 'Số công thực tế' }, // Input
    { id: 'pointReq', name: 'Task point yêu cầu' }, // Formula: KPI * ActualDays * 2

    // Effort
    { id: 'effortConfirmed', name: 'Nỗ lực thực tế - confirmed' },
    { id: 'effortUnconfirmed', name: 'Nỗ lực thực tế - unconfirmed' },
    { id: 'effortTotal', name: 'Tổng nỗ lực thực tế' }, // Sum

    // Points
    { id: 'pointConfirmed', name: 'Task point thực tế - confirmed' },
    { id: 'pointUnconfirmed', name: 'Task point thực tế - unconfirmed' },
    { id: 'pointTotal', name: 'Tổng task point thực tế' }, // Sum

    // Ratios
    { id: 'productivityConfirmed', name: 'Năng suất - confirmed' }, // N = ptConfirmed / effConfirmed
    { id: 'productivityUnconfirmed', name: 'Năng suất - unconfirmed' }, // O
    { id: 'productivityTotal', name: 'Năng suất tổng' }, // P

    { id: 'completionProdConfirmed', name: 'Mức độ hoàn thành năng suất - confirmed' },
    { id: 'completionProdTotal', name: 'Mức độ hoàn thành năng suất - tổng' },
    { id: 'completionPointConfirmed', name: 'Mức độ hoàn thành task point - confirmed' },
    { id: 'completionPointTotal', name: 'Mức độ hoàn thành task point - tổng' },

    { id: 'effortRatio', name: 'Tỷ lệ nỗ lực thống kê' },
    { id: 'taskCount', name: 'Tổng task' }  // New: count of tasks
];
