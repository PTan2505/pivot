# Requirements Specification — Personal UI/UX Resource Library

**Phiên bản:** v0.1  
**Trạng thái:** Bản tổng hợp yêu cầu và đề xuất; một số quyết định vẫn cần được xác nhận.

## 1. Tổng quan sản phẩm

### 1.1. Mục tiêu

Xây dựng một web app chạy local trên máy cá nhân, giúp developer lưu trữ, tổ chức, tìm kiếm và tái sử dụng tài nguyên UI/UX trong quá trình phát triển frontend, đặc biệt khi làm việc với AI như Claude Code.

Ứng dụng không chỉ là nơi lưu bookmark website. Định hướng dài hạn là một **thư viện tri thức frontend cá nhân**, nơi có thể quản lý tài nguyên tham khảo, prompt, skill và quy trình làm việc, rồi đưa chúng vào đúng ngữ cảnh khi giao việc cho AI.

### 1.2. Vấn đề cần giải quyết

- Tài nguyên UI/UX nằm rải rác trong bookmark, file cục bộ, website và nhiều nguồn khác nhau.
- Khó tìm lại website, component, animation hoặc asset đã lưu.
- Chưa có cách thống nhất để liên kết tài nguyên tham khảo với prompt và skill cho một nhiệm vụ.
- Mất thời gian chuẩn bị context cho Claude Code khi triển khai giao diện.
- Prompt và skill dễ bị thất lạc, trùng lặp hoặc khó cập nhật.
- Cần lưu trữ dữ liệu cục bộ và có khả năng sao lưu, khôi phục.

### 1.3. Nguyên tắc sản phẩm

1. **Local-first:** dữ liệu chính được lưu trên máy cá nhân, không phụ thuộc cloud.
2. **All-in-one:** quản lý nhiều loại tài nguyên trong cùng một ứng dụng.
3. **Searchable:** tìm kiếm bằng từ khóa, tag và nhiều bộ lọc.
4. **AI-friendly:** dễ sao chép hoặc xuất tài nguyên để sử dụng với Claude Code.
5. **Extensible:** có thể bổ sung MCP và tính năng AI sau này.
6. **Reusable:** có thể liên kết các tài nguyên với nhau thay vì lưu từng mục riêng lẻ.

## 2. Phạm vi nội dung cần quản lý

Mô hình dữ liệu được đề xuất là `Resource`: mỗi mục trong thư viện là một tài nguyên, nhưng mỗi loại có nội dung và metadata riêng.

| Nhóm tài nguyên | Ví dụ |
|---|---|
| UI/UX References | Website, landing page, dashboard, admin page, CRM |
| UI Libraries | React component libraries, design systems, templates |
| Images & Videos | Ảnh tham khảo, video demo, ảnh chụp giao diện |
| Icons & SVGs | Icon, SVG, logo và vector asset |
| Animations & Interactions | Animation, hiệu ứng chuyển động, micro-interactions |
| Fonts & Color Palettes | Font chữ, bảng màu, typography reference |
| Code Snippets | Đoạn code UI hoặc pattern có thể tái sử dụng |
| Prompts & Briefs | Prompt cho nhiệm vụ cụ thể, brief mô tả giao diện |
| Skills & Workflows | Claude Code skills, hướng dẫn và workflow tái sử dụng |
| Coding Rules | Quy ước code và hướng dẫn triển khai frontend |
| Checklists & SOPs | Checklist review UI, kiểm tra responsive, quy trình |
| MCP Configurations | Cấu hình kết nối công cụ AI và MCP server |

> Đây là phạm vi đề xuất tổng hợp từ các ý tưởng đã trao đổi. Việc đưa toàn bộ nhóm vào MVP vẫn cần được chốt.

### 2.1. Phân biệt Resource, Metadata, Content và Asset

Ví dụ với một website dashboard:

- **Resource:** mục tham khảo website dashboard.
- **Metadata:** tên, URL, tag, loại trang, phong cách, mô tả.
- **Content:** ghi chú hoặc phân tích chi tiết của người dùng về giao diện.
- **Asset:** ảnh chụp màn hình, video hoặc SVG được lưu cục bộ.

Với prompt hoặc skill:

- **Resource:** mục prompt hoặc skill.
- **Metadata:** tên, mục đích, tag, công nghệ liên quan.
- **Content:** nội dung prompt hoặc hướng dẫn của skill.
- **Asset:** file hoặc tài liệu đính kèm nếu có.

Tách các phần này giúp tìm kiếm và chỉnh sửa metadata mà không làm mất nội dung chính hoặc đường dẫn tới file.

## 3. Yêu cầu chức năng (Functional Requirements)

### FR-01. Quản lý tài nguyên

Ứng dụng cần cho phép:

- Tạo, xem, chỉnh sửa và xóa tài nguyên.
- Chọn loại tài nguyên khi tạo.
- Lưu tiêu đề, mô tả, URL, tag và ghi chú cá nhân.
- Phân loại tài nguyên theo các thuộc tính phù hợp với từng loại.
- Lưu nội dung văn bản và liên kết tới file cục bộ.
- Xem trang chi tiết của từng tài nguyên.
- Phát hiện URL trùng lặp để hạn chế lưu cùng website nhiều lần (đề xuất cho giai đoạn sau).

### FR-02. Thêm tài nguyên từ URL

Người dùng có thể dán URL để tạo tài nguyên tham khảo.

Hệ thống cần:

1. Nhận URL từ người dùng.
2. Tự động lấy metadata của trang khi có thể, chẳng hạn tiêu đề và ảnh Open Graph.
3. Cho phép người dùng chỉnh sửa thông tin tự động lấy được.
4. Cho phép bổ sung mô tả, tag, loại trang, domain và phong cách.
5. Lưu tài nguyên sau khi người dùng xác nhận.

Nếu website không cho phép truy cập metadata, ứng dụng vẫn phải cho phép nhập thủ công. Không phụ thuộc hoàn toàn vào khả năng tự động lấy dữ liệu.

### FR-03. Quản lý file và asset

Ưu tiên hỗ trợ:

- Ảnh: PNG, JPG, WebP và các định dạng phổ biến.
- Vector: SVG.
- Video: các định dạng video thông dụng.
- File animation hoặc dữ liệu giao diện phù hợp.
- File văn bản, Markdown và code snippet.

Chức năng:

- Upload file từ máy tính.
- Xem trước file phù hợp với định dạng.
- Gắn file với một hoặc nhiều tài nguyên nếu cần.
- Lưu thông tin nguồn gốc và ghi chú về file.
- Tải file về hoặc mở file khi phù hợp.
- Hiển thị trạng thái khi file bị thiếu hoặc không còn truy cập được.

MVP nên ưu tiên các định dạng phổ biến thay vì cố hỗ trợ mọi loại file.

### FR-04. Quản lý metadata và phân loại

Mỗi loại tài nguyên có bộ metadata phù hợp, đồng thời tái sử dụng một số trường chung.

| Trường | Ý nghĩa |
|---|---|
| `title` | Tên tài nguyên |
| `resourceType` | Loại tài nguyên |
| `description` | Mô tả ngắn |
| `tags` | Các nhãn do người dùng quản lý |
| `createdAt` | Thời điểm tạo |
| `updatedAt` | Thời điểm cập nhật |
| `sourceUrl` | Nguồn trực tuyến, nếu có |
| `notes` | Ghi chú cá nhân |

Metadata đặc thù có thể gồm:

| Trường | Ví dụ |
|---|---|
| `pageType` | Landing page, dashboard, admin |
| `domain` | SaaS, CRM, e-commerce |
| `visualStyle` | Minimal, futuristic, pixel art |
| `uiPattern` | Sidebar, data table, modal |
| `technology` | React, Tailwind CSS, Framer Motion |
| `purpose` | Mục tiêu của prompt hoặc skill |

Không phải mọi trường đều bắt buộc đối với mọi loại tài nguyên.

### FR-05. Tìm kiếm và lọc

Người dùng cần có thể:

- Tìm theo tiêu đề, mô tả, URL, ghi chú hoặc nội dung văn bản phù hợp.
- Lọc theo loại tài nguyên.
- Lọc theo tag.
- Kết hợp nhiều bộ lọc, ví dụ `React + Animation + Dashboard`.
- Xóa bộ lọc và quay lại danh sách đầy đủ.
- Chuyển đổi giữa chế độ hiển thị dạng lưới và danh sách.

Định hướng hiện tại là tìm kiếm từ khóa và bộ lọc; chưa yêu cầu tìm kiếm ngữ nghĩa bằng AI.

### FR-06. Quản lý Prompts & Briefs

Prompt và brief được quản lý như tài nguyên có thể tìm kiếm và tái sử dụng, không chỉ là đoạn văn bản rời rạc.

Trường dữ liệu đề xuất:

- Tên prompt hoặc brief.
- Mục đích sử dụng.
- Nội dung.
- Tag và công nghệ liên quan.
- Ghi chú hoặc hướng dẫn sử dụng.
- Phiên bản hoặc lịch sử chỉnh sửa nếu được triển khai.

Chức năng:

- Tạo và chỉnh sửa.
- Sao chép nội dung.
- Tìm kiếm theo từ khóa và tag.
- Liên kết prompt với website tham khảo, asset hoặc skill.
- Xuất nội dung để sử dụng trong Claude Code.

### FR-07. Quản lý Skills & Workflows

Skill là quy trình hoặc bộ hướng dẫn có thể tái sử dụng cho một nhóm nhiệm vụ, khác với prompt dùng cho một yêu cầu cụ thể.

Ví dụ:

- Skill triển khai dashboard bằng React.
- Skill phân tích UI reference trước khi code.
- Skill kiểm tra responsive.
- Skill review code do AI tạo ra.

Chức năng đề xuất:

- Tạo và chỉnh sửa nội dung skill.
- Lưu tên, mục đích, tag và công nghệ liên quan.
- Đọc nội dung theo cấu trúc rõ ràng.
- Sao chép hoặc xuất skill ra file.
- Hỗ trợ cấu trúc thư mục tương thích với Claude Code khi đã xác định định dạng cần dùng.
- Liên kết skill với prompt, reference và project liên quan.

**Cần chốt:** mức độ quản lý skill trong MVP — chỉ lưu nội dung, lưu và xuất file, hay quản lý đầy đủ việc chỉnh sửa, phiên bản và xuất file.

### FR-08. Collections và liên kết giữa tài nguyên

Đề xuất cho phép gom nhiều tài nguyên vào một collection.

Ví dụ collection `SaaS Dashboard` có thể chứa:

- Website tham khảo.
- UI component libraries.
- Prompt xây dựng dashboard.
- Skill triển khai giao diện.
- SVG, ảnh và animation liên quan.

Ngoài collection, tài nguyên có thể liên kết trực tiếp với nhau. Điều này giúp tạo bộ context có ý nghĩa cho từng nhiệm vụ thay vì tìm từng tài nguyên độc lập.

**Cần chốt:** collections có trong MVP hay để giai đoạn sau.

### FR-09. Tích hợp Claude Code

Định hướng đã xác định là **hybrid: bắt đầu bằng copy/export, sau đó mở rộng sang MCP**.

#### Giai đoạn đầu — Copy & Export

- Chọn nhiều tài nguyên.
- Sao chép context tổng hợp vào clipboard.
- Xuất Markdown mô tả nguồn, ghi chú, tag và cách sử dụng.
- Xuất asset được chọn ra thư mục đích.
- Đưa prompt và skill vào định dạng có thể sử dụng lại.

Ví dụ cấu trúc export:

```text
ui-reference-bundle/
├── context.md
├── prompts/
│   └── dashboard-brief.md
├── skills/
│   └── frontend-implementation/
│       └── SKILL.md
└── assets/
    ├── dashboard-reference.webp
    ├── brand-icon.svg
    └── loading-animation.json
```

`context.md` nên chứa URL nguồn, mô tả, ghi chú cá nhân, tag, UI pattern cần tham khảo và đường dẫn tương đối tới asset đã xuất.

Ứng dụng không nên chỉ xuất đường dẫn file nội bộ nếu Claude Code không thể truy cập chúng. Khi cần dùng file, nên xuất hoặc sao chép file vào thư mục đích được kiểm soát.

#### Giai đoạn sau — MCP

- Cho phép AI truy vấn thư viện.
- Tìm tài nguyên theo từ khóa hoặc tiêu chí phù hợp.
- Đọc metadata và nội dung tài nguyên được phép truy cập.
- Trả về context và đường dẫn tới asset liên quan.

MCP là hướng mở rộng, chưa phải yêu cầu bắt buộc của MVP.

### FR-10. Sao lưu và khôi phục

Định hướng đề xuất: **backup và restore toàn bộ thư viện**.

Gói sao lưu nên bao gồm:

- Metadata và dữ liệu tài nguyên.
- Tags và các phân loại.
- Nội dung prompt, skill và ghi chú.
- Collections và các liên kết giữa tài nguyên.
- File asset được quản lý bởi ứng dụng.
- Thông tin cần thiết để khôi phục quan hệ giữa metadata và file.

Chức năng:

- Xuất một gói backup.
- Nhập gói backup để khôi phục.
- Kiểm tra cấu trúc và tính hợp lệ của dữ liệu trước khi nhập.
- Thông báo lỗi khi thiếu hoặc hỏng file.

Git có thể được cân nhắc sau cho prompt, skill và nội dung dạng text. Không nên mặc định đưa toàn bộ ảnh và video vào Git vì có thể làm repository tăng kích thước nhanh chóng.

Backup nằm cùng ổ đĩa không bảo vệ được dữ liệu nếu ổ đĩa bị hỏng. Khi cần bảo vệ tốt hơn, người dùng nên sao chép gói backup sang vị trí lưu trữ khác.

## 4. Yêu cầu giao diện (UI/UX Requirements)

Các khu vực giao diện được đề xuất:

- **Sidebar:** Library, UI/UX References, Prompts, Skills, Collections, Projects, Settings.
- **Search bar:** tìm kiếm, lọc theo loại tài nguyên, tag, phong cách và công nghệ.
- **Resource cards:** thumbnail, tên, loại, tag và nguồn.
- **Prompt/Skill cards:** tên, mục đích, công nghệ và thao tác copy.
- **Resource detail:** metadata, nội dung, preview file, ghi chú, liên kết, Copy và Export.

Nguyên tắc UI/UX:

- Dễ quét và tìm lại tài nguyên bằng hình ảnh và metadata.
- Hỗ trợ cả tài nguyên dạng hình ảnh lẫn nội dung văn bản.
- Các thao tác thường xuyên như Copy, Edit và Export dễ tìm thấy.
- Bộ lọc có thể kết hợp với nhau.
- Có trạng thái rỗng, loading, lỗi và xác nhận xóa.
- Ưu tiên desktop; responsive có thể được mở rộng theo nhu cầu.

## 5. Kiến trúc và công nghệ

Đây là **đề xuất triển khai**, không phải các yêu cầu công nghệ bắt buộc đã được xác nhận.

### 5.1. Kiến trúc

```text
React + TypeScript + Vite
            |
            v
Node.js + TypeScript + Fastify
            |
      +-----+------+
      |            |
      v            v
   SQLite      Filesystem
 (metadata)   (assets, exports)
```

### 5.2. Công nghệ hỗ trợ đề xuất

| Thành phần | Công nghệ |
|---|---|
| Frontend | React + TypeScript + Vite |
| Local API | Node.js + TypeScript + Fastify |
| Database | SQLite |
| ORM | Drizzle ORM |
| Validation | Zod |
| Unit/integration testing | Vitest |
| End-to-end testing | Playwright |

### 5.3. Storage

Cấu trúc thư mục dự kiến:

```text
data/
├── library.db
├── assets/
│   ├── images/
│   ├── videos/
│   ├── icons/
│   └── animations/
├── thumbnails/
├── exports/
└── backups/
```

- SQLite lưu metadata và quan hệ giữa các tài nguyên.
- Filesystem lưu nội dung file thực tế.
- Database lưu đường dẫn hoặc định danh file, không nhất thiết nhúng toàn bộ file vào database.
- File và metadata cần được quản lý nhất quán khi đổi tên, xóa hoặc khôi phục.

### 5.4. Yêu cầu local-first

- Ứng dụng chạy trên `localhost`.
- Dữ liệu chính nằm trên máy người dùng.
- Không bắt buộc đăng nhập tài khoản cloud.
- Tài nguyên đã lưu cục bộ vẫn xem được khi không có Internet, trong giới hạn dữ liệu đã tải về.
- Fetch metadata, mở website nguồn hoặc tải tài nguyên từ Internet vẫn có thể cần kết nối mạng.
- Backend cần kiểm soát đường dẫn file, quyền truy cập và hoạt động ghi file.

## 6. Yêu cầu phi chức năng (Non-functional Requirements)

| Mã | Yêu cầu |
|---|---|
| NFR-01 | Dữ liệu tồn tại sau khi đóng và khởi động lại ứng dụng. |
| NFR-02 | Tìm kiếm và lọc hoạt động tốt trên thư viện có nhiều tài nguyên. |
| NFR-03 | Metadata và asset không bị mất liên kết khi chỉnh sửa. |
| NFR-04 | Backup và restore bảo toàn nội dung cùng các quan hệ. |
| NFR-05 | Lỗi khi fetch URL hoặc xử lý file không làm hỏng dữ liệu hiện có. |
| NFR-06 | Chỉ cho phép truy cập API local theo chính sách bảo mật đã định. |
| NFR-07 | Kiểm tra URL đầu vào để giảm rủi ro SSRF khi backend truy cập website. |
| NFR-08 | Giới hạn kích thước file, xác thực định dạng và xử lý file không hợp lệ. |
| NFR-09 | Có thể mở rộng resource type và chức năng mới mà không phải thiết kế lại toàn bộ dữ liệu. |
| NFR-10 | Có kiểm thử cho các luồng lưu, sửa, xóa, tìm kiếm, export và restore quan trọng. |

## 7. Phân chia phạm vi theo giai đoạn

### MVP — Phiên bản đầu tiên

Mục tiêu: tạo được thư viện cục bộ dùng hằng ngày.

- [ ] Local app và lưu trữ bền vững.
- [ ] CRUD tài nguyên và metadata.
- [ ] Thêm website từ URL, tự động lấy metadata khi có thể.
- [ ] Upload, preview và quản lý asset.
- [ ] Keyword search, tags và nhiều bộ lọc.
- [ ] Trang chi tiết tài nguyên.
- [ ] Quản lý prompt và skill ở mức đã chốt.
- [ ] Copy context, xuất Markdown và asset.
- [ ] Backup và restore toàn bộ thư viện.

### P1 — Cải thiện trải nghiệm

- [ ] Collections và liên kết tài nguyên.
- [ ] Phát hiện tài nguyên trùng lặp.
- [ ] Thao tác hàng loạt.
- [ ] Nâng cấp khả năng lấy metadata.
- [ ] Quản lý phiên bản prompt/skill nếu cần.

### P2 — Mở rộng AI workflow

- [ ] MCP server để Claude Code truy cập thư viện.
- [ ] Tự động gợi ý tag và phân loại bằng AI.
- [ ] Tìm kiếm ngữ nghĩa hoặc theo hình ảnh.
- [ ] Browser extension để lưu tài nguyên nhanh.
- [ ] Tự động thu thập nhiều tài nguyên từ nguồn được chọn.
- [ ] Tích hợp Git cho nội dung text nếu phù hợp.

## 8. Acceptance Criteria — Tiêu chí nghiệm thu MVP

- [ ] Người dùng có thể thêm URL và lưu tài nguyên.
- [ ] Metadata được lấy tự động khi có thể; nếu thất bại vẫn nhập thủ công được.
- [ ] Người dùng có thể upload, xem trước và lưu asset.
- [ ] Dữ liệu không mất sau khi restart ứng dụng.
- [ ] Tìm kiếm từ khóa và kết hợp nhiều bộ lọc cho kết quả phù hợp.
- [ ] Có thể chỉnh sửa metadata mà không làm mất liên kết tới asset.
- [ ] Có thể quản lý, tìm và sao chép prompt hoặc skill.
- [ ] Có thể chọn nhiều tài nguyên và tạo context cho Claude Code.
- [ ] Markdown export chứa thông tin cần thiết và đường dẫn asset hợp lệ.
- [ ] Asset được export đúng vào thư mục đích được cho phép.
- [ ] Backup và restore bảo toàn dữ liệu, file và quan hệ.
- [ ] Lỗi URL, upload hoặc restore được xử lý rõ ràng, không âm thầm làm mất dữ liệu.

## 9. Các quyết định còn cần chốt

Các nội dung dưới đây chưa nên xem là yêu cầu đã được xác nhận:

1. **Nhóm nội dung MVP:** có đưa Coding Rules, Checklists/SOPs và MCP Configurations vào ngay phiên bản đầu tiên không?
2. **Mức quản lý Skills:** chỉ lưu nội dung; lưu và xuất file/thư mục; hay chỉnh sửa, quản lý phiên bản và xuất file/thư mục?
3. **Chiến lược backup:** chưa cần; xuất/nhập toàn bộ thư viện; Git cho nội dung text; hay backup toàn bộ kết hợp Git?
4. **Collections:** có trong MVP hay để giai đoạn sau?
5. **Lưu asset:** chỉ lưu URL; chỉ file local; hay kết hợp URL và file local?

## 10. Tóm tắt định hướng

Project được định hướng là một **thư viện UI/UX và tri thức frontend cá nhân, chạy local, tích hợp AI theo hướng mở rộng dần**.

Ba lớp chức năng quan trọng nhất:

1. **Collect:** thu thập và lưu website, asset, prompt, skill và các tài nguyên liên quan.
2. **Organize & Retrieve:** quản lý metadata, phân loại, tìm kiếm, lọc và liên kết tài nguyên.
3. **Reuse with AI:** copy context, xuất Markdown và asset cho Claude Code trước; tích hợp MCP sau.

Điểm quan trọng nhất về mặt thiết kế là không biến ứng dụng thành một thư mục bookmark lớn. Mỗi tài nguyên cần có metadata có cấu trúc, nội dung phù hợp với loại tài nguyên và khả năng liên kết với các tài nguyên khác. Như vậy, thư viện mới thực sự giúp tái sử dụng tri thức trong quá trình phát triển frontend.
