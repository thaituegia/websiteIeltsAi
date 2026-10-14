# Cloud environment

Checkout là `/workspace/websiteIeltsAi`, repository GitHub `thaituegia/websiteIeltsAi`. Dùng lại checkout và dữ liệu đang có; không tạo database giả hoặc xóa lịch sử để kiểm tra khởi động.

## Install

```sh
bash /workspace/websiteIeltsAi/scripts/cloud-setup.sh
```

Script yêu cầu Node.js 24+, cài dependency đúng lockfile với cache `/workspace/.npm-cache`, start MongoDB Docker chính thức khi dùng URI local, audit nội dung/bộ mới/bài mẫu, build frontend và seed. URI MongoDB bên ngoài và `.env` private được giữ; không in secrets. Seed **chỉ thêm ID mới chưa có**, giữ dữ liệu học của bộ hiện hành. Nếu còn ID seed cũ, startup dừng và yêu cầu công cụ reset riêng; setup thường không tự xóa database. Xem [bank-reset.md](bank-reset.md) cho yêu cầu reset đã được người dùng cho phép.

Bộ seed hiện tại **fresh-20261011-v3** gồm **810 lessons, 156 mocks, 648 vocabulary, 480 placement**. Health báo MongoDB actual counts, có thể khác manifest nếu đã có nội dung riêng hoặc đề thay thế sau lượt bị hủy. Structural audits không chứng minh học liệu đã được chuyên gia IELTS hiệu chuẩn.

Bản cập nhật tăng ngân hàng lên ba lần bộ v2 và giữ mẫu sau nộp cho mọi Writing/Speaking Task/Part, giữ toàn bộ học liệu/tài khoản/tiến độ của bộ fresh đã dùng. [exam-upgrade.md](exam-upgrade.md) mô tả seed và công cụ cập nhật giữ dữ liệu. Không lặp lại reset của phiên trước khi startup.

Sổ từ trong bài làm dùng collection thẻ từ hiện có, không cần migration/reset. Chọn từ trước nộp chỉ lưu từ và câu gốc; bài hoàn thành mở dịch theo ngữ cảnh bằng ngân hàng khớp câu hoặc khóa OpenAI riêng đang cấu hình. Lịch FSRS cũ được giữ; từ chờ nghĩa chưa vào lượt ôn. Xem [word-notebook.md](word-notebook.md).

Mỗi task cloud đã chạy trong môi trường tách riêng. Làm trực tiếp trong checkout được chọn; chỉ tạo worktree nếu người dùng yêu cầu.

Docker/Compose cần có nếu dùng local helper; nếu không, cấu hình MongoDB thật bên ngoài qua `MONGODB_URI`. Không thay bằng SQLite, JSON hoặc in-memory DB. Image chính thức ghim digest trong `compose.yaml`; không tắt TLS/checksums để tải dependencies.

## Cấu hình hai tài khoản trước khi start

Duo là mặc định. Thiết lập **một** nguồn private `DUO_CREDENTIALS_FILE` hoặc `DUO_ACCOUNTS_JSON`. Tệp JSON là đường dẫn tuyệt đối, file thường quyền `0600`, không symlink; chứa đúng hai roles husband/wife, tên/phone và salted scrypt hash, không có mật khẩu nguyên văn. [docs/duo-auth.md](duo-auth.md) mô tả định dạng và provisioning. Không đưa thông tin thật vào Git, frontend, `VITE_*`, log hoặc lệnh có shell history.

Startup xác minh cấu hình trước khi kết nối/seed; thiếu cấu hình thì dừng rõ ràng. Chỉ hai danh tính cấu hình được login bằng phone/password; đăng ký/email/demo bị tắt. Production luôn dùng Duo. `DUO_ENABLED=false` được giữ cho server regression tests local, không dùng để mở website production cho tài khoản khác.

## Start

```sh
cd /workspace/websiteIeltsAi
npm run mongo:start
NODE_USE_ENV_PROXY=1 PORT=3006 API_PORT=3006 WEB_PORT=5173 npm run dev
```

Cấu hình cloud dùng API 3006, Vite 5173 (mặc định project API 3001); bỏ helper nếu dùng MongoDB bên ngoài. Proxy giữ cookie và Origin cùng phía trình duyệt. `/api/health` qua Vite phải trả `status:ok`, `database:mongodb`, `duoEnabled:true`, `authMode:phone`, `demoEnabled:false` và counts thực. Provider flags chỉ là trạng thái cấu hình.

Cả hai có thể mở bài/đề thường riêng. Lộ trình chung chỉ tạo sau hai placements, bắt đầu từ band thấp hơn; điểm cá nhân không ghi đè band chung. Gate mặc định 5 buổi, có thể 10; hai người pass riêng mới mở chặng sau. Thi nâng band cần cả hai join/present/Ready. Kết quả đạt được bảo lưu và có Companion cho retake; backend đổi band chung đồng thời, trần 8.0. Cookie sessions/drafts/cards/placements/recordings và Duo receipts nằm trong MongoDB, không seed dữ liệu học giả.

## Quy tắc bài thi

Test đầu vào, chế độ thi, Duo Gate và thi nâng band dùng giám sát mặc định. Rời trang, chuyển tab, tải lại hoặc mở thêm trang cùng tài khoản hủy lượt đang làm và yêu cầu học liệu khác. Hủy một lượt trong phòng nâng band hủy lượt hiện tại của cả hai; lịch sử đã hoàn thành trước phòng đó được giữ. Bài luyện tập thường không giám sát và vẫn lưu/tiếp tục được.

Heartbeat duy trì lease 25 giây trên server. Bài đơn lẻ đã được server nhận để chấm cuối cùng có lease xử lý 20 phút. Trong phòng chung, cả hai vẫn cần ở lại khi còn người đang trả lời; khi server đã nhận phần nộp cuối của tất cả người thi thì được rời trang trong lúc chờ AI. Người đồng hành cũng phải giữ hiện diện trước thời điểm đó. Rời phòng trước khi bắt đầu chỉ bỏ Ready và trở lại chờ, không hủy một đề chưa mở. Trình duyệt chỉ báo được trang bị ẩn/rời trang và trang cùng ứng dụng; không thể chặn hoặc biết mọi tab/chương trình khác. Hộp quyền microphone không hủy bài nếu trang vẫn hiển thị.

## Validation

```sh
npm run typecheck
npm run audit:content
npm run audit:fresh
npm run audit:references
npm test
npm run build
npm run test:e2e
```

Build trước Playwright vì fixture Duo phục vụ bundle `dist`. Tests dùng database test riêng, không clear learner DB. Legacy regression server dùng cổng 3003/5175 và `DUO_ENABLED=false`; Duo fixtures mở Express trên cổng loopback trống, tạo credentials synthetic và hai browser contexts. Mỗi fixture đóng server và xóa đúng namespace test. Chromium hệ thống hoặc Playwright Chromium được hỗ trợ; cài bằng `npx playwright install chromium` khi cần.

Kết quả cụ thể/giới hạn phải đọc [validation.md](validation.md); không gọi fixtures/transport test là provider live hoặc VPS deployment.

## Providers và hosting

Luyện thường, Gate khách quan và lưu bài hoạt động không cần provider. OpenAI chấm Writing bằng `gpt-4o`, nhận dạng bằng `whisper-1` và chấm Speaking trực tiếp từ WAV bằng `gpt-audio`; Azure/ElevenLabs là lựa chọn bổ sung. Tất cả credentials nằm phía server. Speaking promotion cần âm thanh và đánh giá âm học hợp lệ; chỉ có transcript thì không xác định được phát âm/full band. Writing/Speaking chưa có band hợp lệ tiếp tục `pending-ai` và chưa nâng band; regrade dùng lại bài/bản ghi của owner sau khi provider sẵn sàng.

Trong cloud secrets dùng `IELTS_OPENAI_API_KEY`; `OPENAI_API_KEY` là alias local. Azure cần region đã chọn và hostname speech đúng trong network policy; MongoDB ngoài cần hostname/mạng thực. Không tự đặt region, voice ID, URI hay key giả.

Cloud phục vụ development/testing. Localhost không phải URL public. VPS đã có website trước đó tại `https://sutonghanyu.vn`; phiên bản Duo trên VPS chỉ được xác nhận sau updater/kiểm tra HTTPS thực, không suy từ cloud build. Cập nhật qua [deploy/README.md](../deploy/README.md), tách riêng app IELTS và giữ MongoDB/proxy/gateway/project khác.

Cấu hình cloud được lưu dưới dạng draft; cần Review → Save → Publish. Lưu draft không restart tiến trình hoặc chứng minh setup thành công trên máy mới; start lại MongoDB/API/Vite ở mỗi phiên khi cần.
