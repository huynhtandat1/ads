# KrakenOcean — Hệ thống quản lý quảng cáo

Quản lý quảng cáo & lưu lượng (affiliate/ad network): nối thượng nguồn (nhà quảng cáo) với
hạ nguồn (media), tính lợi nhuận và thanh toán. Giao diện 3 ngôn ngữ **中 / VI / EN**, đăng
nhập + phân quyền theo vai trò (RBAC), cô lập dữ liệu theo người dùng.

Dự án **tách backend và frontend**:

```
/
├── backend/     API server: Express + TypeScript (tsx) + PostgreSQL
│   ├── src/server.ts   REST API, auth, RBAC, cô lập dữ liệu, audit log, tính thanh toán
│   ├── src/db.ts       kết nối PostgreSQL (pg), tạo schema + seed lần đầu
│   ├── src/seed.ts     dữ liệu mẫu
│   └── .env            DATABASE_URL (sao chép từ .env.example — gitignored)
└── frontend/    SPA: React 18 + TypeScript + Vite + Tailwind v4
    └── src/...         UI, i18n, gọi API qua src/api.ts, cache phản ứng ở src/data/store.ts
```

- **Backend** là nguồn sự thật: lưu dữ liệu trong **PostgreSQL**, xác thực (token), RBAC,
  cô lập dữ liệu theo `scope`, ghi nhật ký thao tác, và tính tổng hợp phiếu thanh toán.
- Dữ liệu lưu ở 1 bảng `entities (collection, id, data jsonb, seq)` — giữ schema linh hoạt
  theo từng collection. Database `krakenocean` + bảng + dữ liệu mẫu **tự tạo lần chạy đầu**.
- **Frontend** giữ một bản cache cục bộ (đồng bộ, mượt) được nạp từ backend khi đăng nhập;
  mọi thay đổi cập nhật cache rồi đẩy lên backend (id do client cấp để tham chiếu nhất quán).

## Yêu cầu
- **PostgreSQL** đang chạy (đã test với PG 16).
- Tạo `backend/.env` từ `backend/.env.example` và sửa `DATABASE_URL` đúng user/mật khẩu:
  `DATABASE_URL=postgresql://postgres:<mật_khẩu>@localhost:5432/krakenocean`

## Chạy dự án
```bash
npm run install:all     # cài deps cho root + backend + frontend
# tạo backend/.env (xem phần Yêu cầu) rồi:
npm run dev             # chạy song song backend (:8787) và frontend (:5173)
```
Hoặc chạy riêng: `npm run dev:api` và `npm run dev:web`.
Build frontend: `npm run build`. Đổi URL API qua biến môi trường `VITE_API_URL` (mặc định
`http://localhost:8787/api`). Reset dữ liệu: `DROP DATABASE krakenocean;` rồi chạy lại backend.

## Tài khoản demo
| Tài khoản | Mật khẩu | Vai trò | Quyền |
|-----------|----------|---------|-------|
| admin | admin | SUPER_ADMIN | Toàn quyền |
| operator | 123456 | OPERATOR | Xem / Tạo / Sửa / Xuất (không Xóa) |
| viewer | 123456 | VIEWER | Chỉ xem (đang tắt — bật ở Quản lý người dùng) |

## API chính (backend)
| Method | Endpoint | Mô tả |
|--------|----------|------|
| POST | `/api/login` | đăng nhập → `{token, user, db}` (db đã lọc theo cô lập) |
| GET | `/api/db` | nạp lại dataset (đã lọc theo scope) |
| POST/PUT/DELETE | `/api/:collection[/:id]` | CRUD (kiểm tra RBAC theo màn) |
| POST | `/api/:collection/:id/toggle` | bật/tắt trạng thái |
| GET | `/api/settlement/preview` | tổng hợp số tiền theo đối tượng + kỳ |

## 5 vấn đề đã xử lý
1. **Cô lập dữ liệu** — backend lọc dataset theo `user.scope` (1 nhà quảng cáo) ở `/api/login`
   và `/api/db`; user bị giới hạn chỉ thấy advertiser/đơn/ID/dữ liệu của mình. Gán scope ở màn
   *Cô lập dữ liệu* (g7c), có hiệu lực khi user đăng nhập lại.
2. **Phiếu thanh toán tự tổng hợp** — nút *Tổng hợp phiếu* gọi `/api/settlement/preview`:
   nhà QC = Σ "Số tiền phải thu" theo kỳ; media = Σ "Số tiền thực nhận". Tự điền tổng tiền.
3. **Nhập dữ liệu AI** — chuyển thành lưới nhập theo ngày (dùng chung khung với màn Nhà QC) +
   nút **AI tự động điền** mô phỏng lấy lưu lượng/quyết toán cho các hàng.
4. **Báo cáo Lợi nhuận tổng (g4a) & Lợi nhuận đơn QC (g4b)** — thống nhất khung REPORT
   (eyebrow, khoảng ngày, Tháng này/trước, toggle Nghiệp vụ/Tất cả ngày, Tìm kiếm, Truy vấn,
   export, dòng Σ Tổng cộng, dòng nhắc); g4a có cột Thuế & Lợi nhuận sau thuế.
5. **Công thức** (cố định, dễ chỉnh ở `backend/src/seed.ts` & `frontend/src/lib/billing.ts`):
   Số tiền phải thu: CPM = đơn giá×lưu lượng/1000 · CPA = đơn giá×lưu lượng · CPS = số tiền×%(đơn giá).
   Media thực nhận = phải thu × tỷ lệ chia% × hệ số.
   Thuế = lợi nhuận × 6% → `TAX_PCT`.

## Bảo mật & kiểm thử
- RBAC + cô lập dữ liệu + audit log thực thi ở **backend** (frontend chỉ ẩn UI theo quyền).
- Đã kiểm thử end-to-end bằng Playwright: 22 màn load sạch (0 lỗi console, 0 key i18n thiếu),
  các báo cáo Truy vấn đúng, AI auto-fill, tổng hợp phiếu, cô lập dữ liệu (operator scope=12
  chỉ thấy 1 nhà QC), RBAC (xóa→403, tạo→200, không token→401).
