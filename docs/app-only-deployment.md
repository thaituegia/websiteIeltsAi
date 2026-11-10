# Cập nhật riêng app IELTS

`deploy/update-app.py COMMIT ARCHIVE_SHA256` dành riêng cho bản cài
`/opt/websiteIeltsAi-20261007T172235Z-7D7gnc`, Compose project
`website-ielts-ai-20261007172235-7d7gnc`, tên miền `https://sutonghanyu.vn`.
Chạy bằng root trong SSH trên VPS, sau khi tải helper từ commit đầy đủ và kiểm
tra SHA256 helper. SHA256 archive là của archive GitHub codeload cùng commit.
Không dùng nhánh `main` hoặc pipe nội dung tải trực tiếp vào shell.

Helper kiểm tra app đang healthy qua `127.0.0.1:19088` và HTTPS của tên miền,
quyền sở hữu container/mạng/tệp, cấu hình đăng nhập hai tài khoản và cấu hình
Compose hiện tại. Helper dùng khóa cập nhật của bản cài để ngăn hai lượt cập nhật
chạy đồng thời. Mọi thông tin riêng chỉ nằm trong tệp có quyền truy cập riêng.

Bản build có giới hạn 512 MiB RAM, không dùng thêm swap và 0,5 CPU. Mỗi bước
đòi hỏi đủ RAM cho công việc cộng 1024 MiB dự phòng; server bận hoặc thiếu RAM
thì dừng khi app cũ vẫn hoạt động. Archive được kiểm tra hash và từ chối link,
đường dẫn vượt ra ngoài thư mục giải nén hoặc archive quá lớn.

Trước khi thay app, hai image được chạy riêng, không có mạng, để so sánh hash
toàn bộ ngân hàng bài học, đề thi, từ vựng và câu đầu vào. Nếu học liệu khác nhau,
helper từ chối cập nhật. Bản cập nhật chỉ được thay image/build context của app;
cấu hình service khác, origin, tài khoản và cấu hình AI phải giữ nguyên. Không
chạy CLI reset/migration, không thay ngân hàng bài, lịch sử, tiến độ, bản ghi âm,
MongoDB, worker tạo audio hoặc cấu hình Nginx dùng chung.

Khi mọi kiểm tra hoàn tất, helper ghi override mới bằng phép thay tệp nguyên tử
rồi dùng `compose up --no-deps --no-build --wait app`. Chỉ app có thể gián đoạn
ngắn trong bước này. Không có bước kiểm tra RAM hay CLI database chen giữa lúc
dừng và mở app. Nếu app mới không healthy, helper khôi phục override và image
thật của app cũ, miễn cấu hình chưa bị một thao tác khác thay đổi.

Website được xác minh qua tên miền và cổng nội bộ 19088. Helper không reload
proxy HTTPS cũ trên cổng 8088; proxy đó có thể cần cập nhật DNS upstream riêng
nếu còn sử dụng. Không restart Docker hoặc Nginx trên host.

Audit riêng nằm trong `.local/deploy/app-updates/`. Chỉ khi có
`complete.json` với `status: verified` mới xem lượt cập nhật là hoàn tất. Nếu
SSH ngắt hoặc helper chưa báo hoàn tất, kiểm tra trạng thái app và audit trước
khi chạy một lượt khác; không tự chạy lại updater ngân hàng học liệu.

Riêng yêu cầu nâng model OpenAI dùng thêm cờ `--upgrade-text-models`.
Chế độ này chỉ cho phép đổi `CONTENT_MODEL`, `EXTRACTOR_MODEL`,
`SCORING_MODEL`, `TRANSLATION_MODEL` thành `gpt-6.1-sol` trong override mới.
Các cấu hình khác, key, tài khoản và dữ liệu vẫn phải giữ nguyên; rollback
khôi phục override trước đó, gồm model cũ. Trước khi build, helper kiểm tra
model bằng key hiện tại cùng hai yêu cầu JSON tổng hợp nhỏ (object và strict
schema) trong container riêng có giới hạn tài nguyên. Xem
[phạm vi và cách xác minh nâng model](openai-model-upgrade.md).

Cờ `--cached-audio-only` cập nhật app và giữ audio có sẵn, không gọi TTS hoặc
thử model AI. Không thể kết hợp với `--upgrade-text-models`. Bước tạo hàng
loạt `--prepare-duo-exams` đã bị loại bỏ; helper từ chối cờ cũ trước khi tải
module/build. Audio còn thiếu tiếp tục chặn phần thi đó trước khi chạy đồng
hồ, không được tự tạo trong request của người học. Xem
[phạm vi đề riêng và chấm đáp án](private-duo-exams.md).

Đợt bổ sung ba bộ Gate 3.0 ngày 10/11/2026 dùng riêng cờ
`--add-three-gate-papers`, không kết hợp các cờ trên. Sau build/kiểm tra online,
helper chạy candidate trong container 384 MiB, không thêm swap, 0,25 CPU và
chỉ nối hai mạng IELTS hiện tại. Job chỉ add/verify chín bài mới và chuẩn bị
ba thông báo nghe đã chỉ định, tối đa ba request/9.000 ký tự cho cả phiên bản;
ledger không tự cấp lại sau lỗi. Thời gian job 180 giây, supervisor 240 giây;
cleanup chỉ được dừng container đúng tên/image/nhãn operation của job này.
Chưa đủ ba audio thì app cũ tiếp tục hoạt động. Kết quả đủ được lưu trong
`gate-supplement.json` và `privateGateSupplement` của receipt cập nhật. Lịch
sử, điểm đã đạt, 484 bài cũ và audio cũ giữ nguyên.

`deploy/inspect-exam-audio.py` kiểm tra từng bài Listening công khai, bài Duo
riêng và câu đầu vào bằng cache metadata. Helper không gọi provider, không
seed/repair và không tạo audio; báo cáo phân biệt bài đủ toàn bộ phần nghe
với bài còn thiếu, theo band/format. Job kiểm tra riêng có giới hạn tài nguyên
và không chạy bên trong cgroup của app đang phục vụ.

Kiểm tra helper trong cloud:

```bash
node --import tsx --test tests/update-app.test.ts
```

Các tình huống kiểm tra dùng Docker, cấu hình và HTTP giả lập; không tác động
VPS hoặc dữ liệu người học. Lệnh đọc hash ngân hàng cũng đã chạy với image Node
24, filesystem chỉ đọc, RAM 512 MiB và swap 512 MiB trong môi trường cloud.
