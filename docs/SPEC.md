# Stan Bag — Requirements v0.2

> Bản v0.2 chốt các quyết định còn mở trong [requirements-v0.1.md](requirements-v0.1.md). Mọi phần không nhắc tới ở đây giữ nguyên như v0.1.

**Ngày chốt:** 2026-10-26

## 1. Quyết định đã chốt

| # | Chủ đề | Quyết định |
|---|---|---|
| 1 | Cách chạy | `npm start` ở root → build (nếu code thay đổi) và chạy server production tại `http://127.0.0.1:4321`. `npm run dev` cho phát triển. |
| 2 | Dữ liệu | Database: không có `DATABASE_URL` → PGlite trong `~/.stan-bag/db` (offline); có → Neon. File: có đủ khoá `R2_*` → **Cloudflare R2** (bucket private, app tự phục vụ file; bổ sung 2026-10-27), không có → lưu trong `~/.stan-bag`. Mỗi asset ghi lại nơi lưu (`assets.storage`), nên chuyển đổi an toàn; Settings có nút chuyển file local lên R2. |
| 3 | Quy mô | Vài trăm resource → tìm kiếm `ILIKE` trên Postgres là đủ, chưa cần full-text index. |
| 4 | Loại tài nguyên | Làm đủ **12 loại** ngay trong MVP (xem §2). |
| 5 | Metadata | Kết hợp: `type` cố định; facet (`pageType`, `domain`, `visualStyle`, `uiPattern`, `technology`) là tag có phân loại, có danh sách gợi ý sẵn nhưng thêm mới được; `tags` tự do. |
| 6 | Projects | Là dự án code thật. **Để sau (P1)**, không có trong MVP. |
| 7 | Screenshot | Tự chụp bằng Playwright khi thêm URL (viewport 1440×900 + full page). Có nút chụp lại và upload thủ công. |
| 8 | Asset | Kết hợp: resource lưu URL nguồn; file luôn được copy vào kho do app quản lý (R2 hoặc thư mục dữ liệu). |
| 9 | Skills | Chỉ quản lý **skill global** trong `~/.claude/skills`. Đồng bộ (scan) vào app, chỉnh sửa, ghi ngược ra `SKILL.md` khi bấm Save to disk. Mỗi skill có thêm trường **When to use** (ứng dụng của skill). |
| 10 | Prompt variables | Có. Cú pháp `{{variable}}`; khi copy sẽ hiện form điền biến. |
| 11 | Lịch sử phiên bản | Không làm. |
| 12 | Collections | Có trong MVP ở mức đơn giản (gom resource, export cả collection). Liên kết trực tiếp resource ↔ resource để P1. |
| 13 | Export | Thư mục đích tùy chọn (luôn tạo thư mục con mới, không ghi đè); ước tính token; tùy chọn resize ảnh (cạnh dài tối đa 1568px). |
| 14 | Xóa | Thùng rác (soft delete), tự dọn sau 30 ngày. File asset chỉ bị xóa khi không còn resource nào dùng. |
| 15–16 | Backup/restore | Chưa làm. |
| 17 | Import | Nhập thủ công; có ô dán **nhiều URL** (mỗi dòng một URL) để thêm hàng loạt. |
| 18 | Ngôn ngữ UI | Tiếng Anh. |
| 19 | Thiết kế | Hướng **Savee** (mockup phương án 3, chốt 2026-10-27): nền đen, phân tầng bằng surface thay vì viền, mọi control dạng viên thuốc, một nút indigo chính mỗi màn hình, font Geist, không sidebar (thanh trên cùng + tab loại). Chi tiết: [DESIGN.md](../DESIGN.md). |
| 20 | Phím tắt | Command palette `⌘K`; dán URL hoặc ảnh ở bất kỳ đâu để tạo resource. |
| 21 | Stack | Next.js (App Router) + pnpm + shadcn/ui + Tailwind v4 + TanStack Query + Drizzle ORM (Neon / PGlite). |
| 22 | Repo | pnpm monorepo: `apps/web` (Next.js), `packages/core` (schema, data access, logic dùng chung — sau này `apps/mcp` dùng lại). |

## 2. Mười hai loại tài nguyên

| Key | Nhãn | Nội dung chính | Trường riêng |
|---|---|---|---|
| `reference` | UI/UX Reference | URL + screenshot | facet pageType, domain, visualStyle, uiPattern |
| `library` | UI Library | URL (docs/repo) | facet technology |
| `media` | Image & Video | file ảnh/video | — |
| `icon` | Icon & SVG | file SVG/ảnh | — |
| `animation` | Animation | file (Lottie JSON, video, GIF) hoặc URL | facet technology |
| `typography` | Font & Palette | danh sách màu hex, tên font | `colors[]`, `fonts[]` |
| `snippet` | Code Snippet | code | `language` |
| `prompt` | Prompt & Brief | text có `{{variables}}` | `purpose` |
| `skill` | Skill | nội dung `SKILL.md` | `skillName`, `whenToUse`, trạng thái đồng bộ |
| `rule` | Coding Rule | markdown | `purpose` |
| `checklist` | Checklist & SOP | markdown `- [ ]` | `purpose` |
| `mcp` | MCP Config | JSON | `serverName` |

Mọi loại đều có các trường chung: `title`, `description`, `sourceUrl`, `notes`, `tags`, `createdAt`, `updatedAt`, và có thể gắn asset.

## 3. Bảo mật (bổ sung NFR-06, NFR-07)

- Server chỉ bind `127.0.0.1`.
- Middleware chặn request có header `Host` không phải localhost (chống DNS rebinding) và request ghi có `Origin` khác host (chống CSRF).
- Fetch metadata và screenshot: chỉ `http/https`, resolve DNS và chặn IP private, loopback, link-local (SSRF).
- Upload: giới hạn 200MB/file, kiểm tra MIME theo danh sách cho phép.
- Ghi file ra ngoài thư mục dữ liệu chỉ xảy ra ở hai chỗ, và đều do người dùng chủ động bấm: export bundle và Save skill to disk.

## 4. Chrome extension (bổ sung 2026-10-26, chuyển từ P2)

- Popup (⌥⇧S): chụp phần đang hiển thị của tab (thấy được trang đã đăng nhập), đọc tiêu đề/mô tả từ DOM trang, chọn type, facet, ghi chú, collection; tuỳ chọn để server chụp thêm full-page.
- Lưu nhanh (⌥⇧D), menu chuột phải cho trang, link, ảnh và đoạn text được chọn (lưu thành snippet/prompt).
- Ghép nối bằng API token (`~/.stan-bag/api-token`, xem/đổi trong Settings). Request ghi từ origin khác phải có `Authorization: Bearer <token>`.
- Endpoint: `POST /api/clip`, `GET /api/lookup`, `POST /api/ping`, `GET|POST /api/settings/token`.

## 5. Ngoài phạm vi MVP

Projects, backup/restore, liên kết resource ↔ resource, phát hiện trùng lặp nâng cao (MVP chỉ cảnh báo URL trùng), MCP server, AI tagging.
