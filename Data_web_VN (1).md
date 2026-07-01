# Data web

## 广告主 — NHÀ QUẢNG CÁO (Thượng nguồn)

### Quản lý nhà quảng cáo

- **Tạo nhà quảng cáo mới**
  - Nhà quảng cáo — *Nhập tay* — Nhà quảng cáo là duy nhất, dùng uuid nhưng không hiển thị — **Bắt buộc**
  - Số điện thoại — *Nhập tay* — **Bắt buộc**
  - Người liên hệ — *Nhập tay* — **Bắt buộc**
  - Email — *Nhập tay*
  - Ghi chú — *Nhập tay*
  - Trạng thái
    - Bật — *Mặc định*
    - Tắt
    - Xóa
      - Nếu không có dữ liệu liên quan → xóa vĩnh viễn
      - Nếu có dữ liệu liên quan → không hiển thị ở giao diện trước (front-end)
- **Bộ lọc**
  - Đơn quảng cáo
  - Trạng thái
  - Tìm kiếm mờ: Nhà quảng cáo / Đơn quảng cáo / Ghi chú
- **Danh sách nhà quảng cáo** *(mặc định hiển thị tất cả)*
  - STT — *Tự sinh* — luôn hiển thị theo thứ tự dù sắp xếp theo điều kiện nào
  - Nhà quảng cáo — *Đọc* — từ thông tin tạo — sắp xếp theo chữ cái đầu
  - Đơn quảng cáo — *Đọc* — từ thông tin liên kết khi tạo đơn quảng cáo — sắp xếp theo chữ cái đầu
  - Số điện thoại — *Đọc* — từ thông tin tạo
  - Người liên hệ — *Đọc* — từ thông tin tạo
  - Email — *Đọc* — từ thông tin tạo
  - Ghi chú — *Đọc* — từ thông tin tạo
  - Trạng thái — *Đọc* — từ thông tin tạo
    - Sửa
      - Bật
      - Tắt
  - Sửa — bấm vào để vào trang sửa, giống trang tạo mới
    - Sửa
    - Xóa
      - Nếu không có dữ liệu liên quan → xóa vĩnh viễn
      - Nếu có dữ liệu liên quan → không hiển thị ở giao diện trước

### Quản lý đơn quảng cáo

- **Tạo đơn quảng cáo mới**
  - Nhà quảng cáo — *Đọc* — chọn từ danh sách nhà quảng cáo — **Bắt buộc**
  - Đơn quảng cáo — *Nhập tay* — Đơn quảng cáo là duy nhất, dùng uuid nhưng không hiển thị — **Bắt buộc**
  - Ghi chú — *Nhập tay*
  - Trạng thái
    - Bật — *Mặc định*
    - Tắt
    - Xóa
      - Nếu không có dữ liệu liên quan → xóa vĩnh viễn
      - Nếu có dữ liệu liên quan → không hiển thị ở giao diện trước
- **Bộ lọc**
  - Nhà quảng cáo
  - Trạng thái
  - Tìm kiếm mờ: Nhà quảng cáo / Đơn quảng cáo / Ghi chú
- **Danh sách đơn quảng cáo** *(mặc định hiển thị tất cả)*
  - STT — *Tự sinh* — luôn hiển thị theo thứ tự
  - Nhà quảng cáo — *Đọc* — từ thông tin tạo — sắp xếp theo chữ cái đầu
  - Đơn quảng cáo — *Đọc* — từ thông tin tạo — sắp xếp theo chữ cái đầu
  - Số lượng link — *Đọc* — đọc từ số lượng ID quảng cáo gắn vào đơn quảng cáo này
  - Ghi chú — *Đọc* — từ thông tin tạo
  - Trạng thái — *Đọc* — từ thông tin tạo
    - Sửa
      - Bật
      - Tắt
  - Sửa — bấm vào để vào trang sửa, giống trang tạo mới
    - Sửa
    - Xóa
      - Nếu không có dữ liệu liên quan → xóa vĩnh viễn
      - Nếu có dữ liệu liên quan → không hiển thị ở giao diện trước

### Quản lý ID quảng cáo

- **Tạo ID quảng cáo mới**
  - Nhà quảng cáo — *Đọc* — chọn từ danh sách nhà quảng cáo — **Bắt buộc**
  - Đơn quảng cáo — *Đọc* — chọn từ danh sách Đơn quảng cáo — **Bắt buộc**
  - ID quảng cáo — *Nhập tay* — duy nhất, dùng uuid nhưng không hiển thị — **Bắt buộc**
  - Loại — *Chọn tay phân loại*
    - CPM
    - CPC
    - CPA
    - CPS
  - Đơn giá / Tỷ lệ chia — *Đọc theo loại đã chọn*
    - Đơn giá (CPM/CPC/CPA) — *Nhập tay*
    - Tỷ lệ chia (CPS) — *Nhập tay*
  - Ghi chú — *Nhập tay*
  - Trạng thái
    - Bật — *Mặc định*
    - Tắt
    - Xóa
      - Nếu không có dữ liệu liên quan → xóa vĩnh viễn
      - Nếu có dữ liệu liên quan → không hiển thị ở giao diện trước
- **Bộ lọc**
  - Nhà quảng cáo
  - Đơn quảng cáo
  - Loại
  - Đơn giá / Tỷ lệ chia
  - Trạng thái
  - Tìm kiếm mờ: Nhà quảng cáo / Đơn quảng cáo / ID quảng cáo / Ghi chú
  - Lọc phân tầng
- **Danh sách ID quảng cáo** *(mặc định hiển thị tất cả)*
  - STT — *Tự sinh* — luôn hiển thị theo thứ tự
  - Nhà quảng cáo — *Đọc* — từ thông tin tạo — sắp xếp theo chữ cái đầu
  - Đơn quảng cáo — *Đọc* — từ thông tin tạo — sắp xếp theo chữ cái đầu
  - ID quảng cáo — *Đọc* — từ thông tin tạo — sắp xếp theo chữ cái đầu
  - Loại — *Đọc* — từ thông tin tạo
  - Đơn giá / Tỷ lệ chia — *Đọc* — từ thông tin tạo
  - Ghi chú — *Đọc* — từ thông tin tạo
  - Trạng thái — *Đọc* — từ thông tin tạo
    - Sửa
      - Bật
      - Tắt
  - Sửa — bấm vào để vào trang sửa, giống trang tạo mới
    - Sửa
    - Xóa
      - Nếu không có dữ liệu liên quan → xóa vĩnh viễn
      - Nếu có dữ liệu liên quan → không hiển thị ở giao diện trước

---

## 媒体 — MEDIA (Hạ nguồn)

### Quản lý media

- **Tạo media mới**
  - Media — *Nhập tay* — duy nhất, dùng uuid nhưng không hiển thị — **Bắt buộc**
  - Số điện thoại — *Nhập tay* — **Bắt buộc**
  - Người liên hệ — *Nhập tay* — **Bắt buộc**
  - Email — *Nhập tay*
  - Ghi chú — *Nhập tay*
  - Trạng thái
    - Bật — *Mặc định*
    - Tắt
    - Xóa
      - Nếu không có dữ liệu liên quan → xóa vĩnh viễn
      - Nếu có dữ liệu liên quan → không hiển thị ở giao diện trước
- **Bộ lọc**
  - Đơn quảng cáo media
  - Trạng thái
  - Tìm kiếm mờ: Media / Đơn quảng cáo media / Ghi chú
- **Danh sách media** *(mặc định hiển thị tất cả)*
  - STT — *Tự sinh* — luôn hiển thị theo thứ tự
  - Media — *Đọc* — từ thông tin tạo — sắp xếp theo chữ cái đầu
  - Đơn quảng cáo media — *Đọc* — từ thông tin liên kết khi tạo đơn quảng cáo media — sắp xếp theo chữ cái đầu
  - Số điện thoại — *Đọc* — từ thông tin tạo
  - Người liên hệ — *Đọc* — từ thông tin tạo
  - Email — *Đọc* — từ thông tin tạo
  - Ghi chú — *Đọc* — từ thông tin tạo
  - Trạng thái — *Đọc* — từ thông tin tạo
    - Sửa
      - Bật
      - Tắt
  - Sửa — bấm vào để vào trang sửa, giống trang tạo mới
    - Sửa
    - Xóa
      - Nếu không có dữ liệu liên quan → xóa vĩnh viễn
      - Nếu có dữ liệu liên quan → không hiển thị ở giao diện trước

### Quản lý đơn quảng cáo media

- **Tạo đơn quảng cáo media mới**
  - Media — *Đọc* — chọn từ danh sách media — **Bắt buộc**
  - Đơn quảng cáo media — *Nhập tay* — duy nhất, dùng uuid nhưng không hiển thị — **Bắt buộc**
  - Ghi chú — *Nhập tay*
  - Trạng thái
    - Bật — *Mặc định*
    - Tắt
    - Xóa
      - Nếu không có dữ liệu liên quan → xóa vĩnh viễn
      - Nếu có dữ liệu liên quan → không hiển thị ở giao diện trước
- **Bộ lọc**
  - Media
  - Trạng thái
  - Tìm kiếm mờ: Media / Đơn quảng cáo media / Ghi chú
- **Danh sách đơn quảng cáo media** *(mặc định hiển thị tất cả)*
  - STT — *Tự sinh* — luôn hiển thị theo thứ tự
  - Media — *Đọc* — từ thông tin tạo — sắp xếp theo chữ cái đầu
  - Đơn quảng cáo media — *Đọc* — từ thông tin tạo — sắp xếp theo chữ cái đầu
  - Số lượng link — *Đọc* — đọc từ số lượng media ID gắn vào đơn quảng cáo media này
  - Ghi chú — *Đọc* — từ thông tin tạo
  - Trạng thái — *Đọc* — từ thông tin tạo
    - Sửa
      - Bật
      - Tắt
  - Sửa — bấm vào để vào trang sửa, giống trang tạo mới
    - Sửa
    - Xóa
      - Nếu không có dữ liệu liên quan → xóa vĩnh viễn
      - Nếu có dữ liệu liên quan → không hiển thị ở giao diện trước

### Quản lý media ID

- **Tạo media ID mới**
  - Nhà quảng cáo — *Đọc* — chọn từ danh sách nhà quảng cáo — **Bắt buộc**
  - Đơn quảng cáo — *Đọc* — chọn từ danh sách Đơn quảng cáo — **Bắt buộc**
  - ID quảng cáo — *Đọc* — chọn từ danh sách ID quảng cáo — **Bắt buộc**
  - Media — *Đọc* — chọn từ danh sách media — **Bắt buộc**
  - Đơn quảng cáo media — *Đọc* — chọn từ danh sách Đơn quảng cáo media — **Bắt buộc**
  - Media ID — *Nhập tay* — duy nhất, dùng uuid nhưng không hiển thị — **Bắt buộc**
  - Loại — *Chọn tay phân loại*
    - CPM
    - CPC
    - CPA
    - CPS
  - Đơn giá / Tỷ lệ chia — *Đọc theo loại*
    - Đơn giá (CPM/CPC/CPA) — *Nhập tay*
    - Tỷ lệ chia (CPS) — *Nhập tay*
  - Tỷ lệ chia tài khoản (分账比例) — *Nhập tay* — **Bắt buộc chọn**
  - Ghi chú — *Nhập tay*
  - Trạng thái
    - Bật — *Mặc định*
    - Tắt
    - Xóa
      - Nếu không có dữ liệu liên quan → xóa vĩnh viễn
      - Nếu có dữ liệu liên quan → không hiển thị ở giao diện trước
- **Bộ lọc**
  - Nhà quảng cáo
  - Đơn quảng cáo
  - ID quảng cáo
  - Media
  - Đơn quảng cáo media
  - Media ID
  - Loại
  - Đơn giá / Tỷ lệ chia
  - Tỷ lệ chia tài khoản
  - Trạng thái
  - Tìm kiếm mờ: Nhà quảng cáo / Đơn quảng cáo / ID quảng cáo / Media / Đơn quảng cáo media / Media ID / Ghi chú
  - Lọc phân tầng
- **Danh sách media ID** *(mặc định hiển thị tất cả)*
  - STT — *Tự sinh* — luôn hiển thị theo thứ tự
  - Media — *Đọc* — từ thông tin tạo — sắp xếp theo chữ cái đầu
  - Đơn quảng cáo media — *Đọc* — từ thông tin tạo — sắp xếp theo chữ cái đầu
  - Media ID — *Đọc* — từ thông tin tạo — sắp xếp theo chữ cái đầu
  - Nhà quảng cáo — *Đọc* — từ thông tin tạo
  - Đơn quảng cáo — *Đọc* — từ thông tin tạo
  - ID quảng cáo — *Đọc* — từ thông tin tạo
  - Loại — *Đọc* — từ thông tin tạo
  - Đơn giá / Tỷ lệ chia — *Đọc* — từ thông tin tạo
  - Tỷ lệ chia tài khoản — *Đọc* — từ thông tin tạo
  - Ghi chú — *Đọc* — từ thông tin tạo
  - Trạng thái — *Đọc* — từ thông tin tạo
    - Sửa
      - Bật
      - Tắt
  - Sửa — bấm vào để vào trang sửa, giống trang tạo mới
    - Sửa
    - Xóa
      - Nếu không có dữ liệu liên quan → xóa vĩnh viễn
      - Nếu có dữ liệu liên quan → không hiển thị ở giao diện trước

---

## 数据录入 — NHẬP LIỆU DỮ LIỆU

### Nhập liệu dữ liệu nhà quảng cáo

- **Bộ lọc**
  - Ngày — chọn khoảng thời gian
  - Nhà quảng cáo
  - Đơn quảng cáo
  - Loại
  - Đơn giá / Tỷ lệ chia
  - Trạng thái
  - Tìm kiếm mờ: Nhà quảng cáo / Đơn quảng cáo / ID quảng cáo / Loại / Đơn giá (tỷ lệ chia)
  - Lọc phân tầng
- **Danh sách nhập liệu**
  - STT — *Tự sinh* — luôn hiển thị theo thứ tự
  - Ngày hôm nay — *Tự sinh*
  - Nhà quảng cáo — *Đọc* — sắp xếp theo chữ cái đầu
  - Đơn quảng cáo — *Đọc* — sắp xếp theo chữ cái đầu
  - Loại — *Đọc* — sắp xếp theo chữ cái đầu
  - ID quảng cáo — *Đọc* — sắp xếp theo chữ cái đầu
  - Đơn giá / Tỷ lệ chia — *Đọc* — từ thông tin khi tạo ID quảng cáo này
    - Sửa
      - Có hiệu lực hiện tại
      - Có hiệu lực về sau
  - Dữ liệu lưu lượng / Số tiền — *Nhập tay*
  - Dữ liệu quyết toán / Số tiền — *Nhập tay*
  - Số tiền phải thu — *Tính toán*
    - Đơn giá × Dữ liệu lưu lượng → khi có dữ liệu quyết toán / số tiền thì cập nhật thành: Đơn giá × Dữ liệu quyết toán
    - Tỷ lệ chia × Số tiền → khi có dữ liệu quyết toán / số tiền thì cập nhật thành: Tỷ lệ chia × Số tiền quyết toán
    - **Lưu ý CPM (chuẩn ngành):** với loại **CPM** = Đơn giá × cơ sở **/ 1000** (cost per mille — tính trên mỗi 1000 lượt). CPC/CPA vẫn là Đơn giá × cơ sở (không chia).
  - Trạng thái — *Đọc* — từ trạng thái ID hiện tại
    - Sửa
      - Bật
      - Tắt
  - Xác nhận — *Nút* — cập nhật cơ sở dữ liệu

### Quản lý dữ liệu media

- **Bộ lọc**
  - Ngày — chọn khoảng thời gian
  - Media
  - Đơn quảng cáo media
  - Loại
  - Đơn giá / Tỷ lệ chia
  - Trạng thái
  - Tìm kiếm mờ: Nhà quảng cáo / Đơn quảng cáo / ID quảng cáo / Loại / Đơn giá (tỷ lệ chia) / Tỷ lệ chia tài khoản
  - Lọc phân tầng
- **Danh sách dữ liệu media**
  - STT — *Tự sinh* — luôn hiển thị theo thứ tự
  - Ngày hôm nay — *Tự sinh*
  - Media — *Đọc* — sắp xếp theo chữ cái đầu
  - Đơn quảng cáo media — *Đọc* — sắp xếp theo chữ cái đầu
  - Loại — *Đọc* — sắp xếp theo chữ cái đầu
  - Media ID — *Đọc* — sắp xếp theo chữ cái đầu
  - Đơn giá / Tỷ lệ chia — *Đọc* — từ thông tin khi tạo ID quảng cáo này
    - Sửa
      - Có hiệu lực hiện tại
      - Có hiệu lực về sau
  - Dữ liệu lưu lượng / Số tiền — *Đọc* — từ nhập liệu dữ liệu nhà quảng cáo, theo ID quảng cáo tương ứng
  - Dữ liệu quyết toán / Số tiền — *Đọc* — từ nhập liệu dữ liệu nhà quảng cáo, theo ID quảng cáo tương ứng
  - Hệ số dữ liệu — *Đọc*
    - 100% — *Mặc định*
    - Sửa
      - Có hiệu lực hiện tại
      - Có hiệu lực về sau
  - Số tiền phải trả — *Tính toán*
    - Đơn giá × Dữ liệu quyết toán × Hệ số dữ liệu → khi có dữ liệu quyết toán / số tiền thì cập nhật thành: Đơn giá × Dữ liệu quyết toán
    - Tỷ lệ chia × Số tiền × Hệ số dữ liệu → khi có dữ liệu quyết toán / số tiền thì cập nhật thành: Tỷ lệ chia × Số tiền quyết toán
  - Tỷ lệ chia tài khoản — *Đọc* — từ thông tin khi tạo ID quảng cáo này
    - Sửa
      - Có hiệu lực hiện tại
      - Có hiệu lực về sau
  - Số tiền thực trả — Số tiền phải thu × Tỷ lệ chia tài khoản
  - Trạng thái — *Đọc* — từ trạng thái ID hiện tại
    - Sửa
      - Bật
      - Tắt
  - Xác nhận — *Nút* — cập nhật cơ sở dữ liệu

---

## 数据查询 — TRA CỨU DỮ LIỆU

### Bảng tổng lợi nhuận — *Đọc*

- **Bộ lọc** — chọn khoảng thời gian
- Bảng lợi nhuận tháng hiện tại
  - Từ ngày 1 của tháng → ngày hiện tại
  - Tổng lợi nhuận mỗi ngày theo từng nghiệp vụ — phân theo nghiệp vụ, tổng mỗi ngày
  - Tổng lợi nhuận tháng theo từng nghiệp vụ — phân theo nghiệp vụ, tổng trong tháng

### Bảng lợi nhuận theo nghiệp vụ — *ví dụ: sm*

- **Bộ lọc** — chọn khoảng thời gian
- Bảng lợi nhuận trong ngày
  - Ngày hiện tại
- **Tổng quan lợi nhuận nghiệp vụ**
  - Lợi nhuận — *Tự tính* — Thu − Chi − Thuế
  - Thu — *Đọc* — thu từ nhà quảng cáo
  - Chi — *Đọc* — chi cho media
  - Điểm thuế — *Đọc*
    - 6% — *Mặc định*
    - Sửa
      - Có hiệu lực hiện tại
      - Có hiệu lực về sau
  - Số tiền thuế — *Tự tính* — (Thu − Chi) × Điểm thuế
  - Tỷ suất lợi nhuận — *Tự tính*
- **Chi tiết lợi nhuận nghiệp vụ**
  - Thu từ nhà quảng cáo
    - Gồm số tiền phải thu của tất cả nhà quảng cáo thuộc nghiệp vụ này
    - Sắp xếp theo chữ cái đầu tên công ty
  - Chi cho media
    - Gồm số tiền thực trả của tất cả media thuộc nghiệp vụ này, hiển thị theo tên công ty
    - Sắp xếp theo chữ cái đầu tên công ty

### Tra cứu dữ liệu nhà quảng cáo

- **Bộ lọc**
  - Ngày — chọn khoảng thời gian
  - Nhà quảng cáo
  - Đơn quảng cáo
  - ID quảng cáo
  - Loại
  - Đơn giá / Tỷ lệ chia
  - Trạng thái
  - Tìm kiếm mờ: Nhà quảng cáo / Đơn quảng cáo / ID quảng cáo / Loại / Đơn giá (tỷ lệ chia) / Tỷ lệ chia tài khoản
  - Lọc phân tầng
- **Tải dữ liệu** — *Nút* — tải dữ liệu theo điều kiện hiện tại
- **Danh sách dữ liệu**
  - STT — *Tự sinh* — luôn hiển thị theo thứ tự
  - Ngày
    - Hôm nay — *Mặc định*
    - Ngày tra cứu
  - Nhà quảng cáo — *Đọc* — sắp xếp theo chữ cái đầu
  - Đơn quảng cáo — *Đọc* — sắp xếp theo chữ cái đầu
  - Loại — *Đọc* — sắp xếp theo chữ cái đầu
  - ID quảng cáo — *Đọc* — sắp xếp theo chữ cái đầu
  - Đơn giá / Tỷ lệ chia — *Đọc* — từ nhập liệu dữ liệu nhà quảng cáo
  - Dữ liệu lưu lượng / Số tiền — *Đọc* — từ nhập liệu dữ liệu nhà quảng cáo
  - Dữ liệu quyết toán / Số tiền — *Đọc* — từ nhập liệu dữ liệu nhà quảng cáo
  - Số tiền phải thu — *Đọc* — từ nhập liệu dữ liệu nhà quảng cáo
  - Trạng thái — *Đọc* — từ trạng thái ID hiện tại

### Tra cứu dữ liệu media

- **Bộ lọc**
  - Ngày — chọn khoảng thời gian
  - Media
  - Đơn quảng cáo media
  - Media ID
  - Loại
  - Đơn giá / Tỷ lệ chia
  - Trạng thái
  - Tìm kiếm mờ: Nhà quảng cáo / Đơn quảng cáo / ID quảng cáo / Loại / Đơn giá (tỷ lệ chia) / Tỷ lệ chia tài khoản
  - Lọc phân tầng
- **Tải dữ liệu** — *Nút* — tải dữ liệu theo điều kiện hiện tại
- **Danh sách dữ liệu media**
  - STT — *Tự sinh* — luôn hiển thị theo thứ tự
  - Ngày
    - Hôm nay — *Mặc định*
    - Ngày tra cứu
  - Media — *Đọc* — sắp xếp theo chữ cái đầu
  - Đơn quảng cáo media — *Đọc* — sắp xếp theo chữ cái đầu
  - Loại — *Đọc* — sắp xếp theo chữ cái đầu
  - Media ID — *Đọc* — sắp xếp theo chữ cái đầu
  - Đơn giá / Tỷ lệ chia — *Đọc* — từ quản lý dữ liệu media
  - Dữ liệu lưu lượng / Số tiền — *Đọc* — từ quản lý dữ liệu media
  - Dữ liệu quyết toán / Số tiền — *Đọc* — từ quản lý dữ liệu media
  - Số tiền phải trả — *Đọc* — từ quản lý dữ liệu media
  - Tỷ lệ chia tài khoản — *Đọc* — từ quản lý dữ liệu media
  - Số tiền thực thu — *Đọc* — từ quản lý dữ liệu media
  - Trạng thái — *Đọc* — từ trạng thái ID hiện tại

---

## 结算单 — PHIẾU QUYẾT TOÁN

## 操作记录 — NHẬT KÝ THAO TÁC

## 系统管理 — QUẢN LÝ HỆ THỐNG

*(Các phần dưới trong bản gốc chỉ liệt kê lặp lại: Bộ lọc / Đọc — chưa có nội dung chi tiết)*

- Bộ lọc — *Đọc*
- Bộ lọc — *Đọc*
- Bộ lọc — *Đọc*
- (… danh sách "Đọc" lặp lại nhiều lần, nội dung chưa định nghĩa)
