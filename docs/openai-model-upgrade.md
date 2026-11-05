# Cập nhật model OpenAI

API key xác thực tài khoản/project; phiên bản model được chọn trong từng yêu
cầu API. Bản cập nhật này giữ key hiện tại và đặt model văn bản mặc định là
`gpt-6.1-sol` cho `CONTENT_MODEL`, `EXTRACTOR_MODEL`, `SCORING_MODEL` và
`TRANSLATION_MODEL`. Giá trị môi trường được cấu hình rõ ràng vẫn có hiệu lực.
Metadata model cũ trong gói credentials được mã hóa vẫn được đọc để tương thích,
nhưng không còn quyết định mặc định model của runtime mới.

Ngày 05/11/2026, model này được xác minh trong
[ChatModel của SDK OpenAI chính thức](https://github.com/openai/openai-node/blob/738695092f2d8e9e092de7bd19f0994e0ba68e25/src/resources/shared.ts#L103).
SDK cũng ghi rõ `max_tokens` đã được thay bằng
[`max_completion_tokens`](https://github.com/openai/openai-node/blob/738695092f2d8e9e092de7bd19f0994e0ba68e25/src/resources/chat/completions/completions.ts#L2411).
Yêu cầu văn bản dùng tham số mới, JSON object và bộ kiểm tra điểm/dẫn chứng hiện
có; không gửi temperature hoặc reasoning effort chưa được xác minh riêng cho
model. Ngân sách token bao gồm cả reasoning, được giới hạn riêng cho từng vai
trò. Writing giữ timeout 90 giây mỗi bước; dịch từ có timeout 30 giây.

Speaking có bản ghi vẫn dùng `gpt-audio` để nghe waveform thực tế. Nhận dạng
giữ `whisper-1` cùng định dạng chứa duration; Listening giữ
`gpt-4o-mini-tts` cùng dấu vân tay audio đã tạo. Những model chuyên âm thanh
này có chức năng khác model văn bản. Nâng model văn bản không tạo lại audio
hoặc sửa transcript đã lưu.

Với VPS hiện có, nâng riêng source chưa đủ nếu Compose đang đặt model cũ.
`deploy/update-app.py COMMIT ARCHIVE_SHA256 --upgrade-text-models` chỉ được
phép đổi bốn biến model văn bản nói trên thành đúng `gpt-6.1-sol`, đồng thời
thay image/source của app IELTS. Không sửa tệp key hoặc thông tin đăng nhập.
Lệnh không có cờ này tiếp tục giữ nguyên toàn bộ cấu hình môi trường cũ.

Trước khi build, chế độ nâng model kiểm tra quyền truy cập model bằng key của
app hiện tại và gửi hai yêu cầu JSON nhỏ với dữ liệu tổng hợp để kiểm tra cả
JSON object và strict JSON Schema trong container riêng có giới hạn tài nguyên.
Các yêu cầu thử này có thể phát sinh phí API; không chứa bài làm hay
bản ghi của người học. Khi quyền/model/response chưa đạt, helper dừng trước
khi thay app. Không tự chuyển sang model cũ để che lỗi quyền hoặc hạn mức.

Các kiểm tra RAM (512 MiB cho thao tác và 1 GiB dự phòng), ngân hàng học liệu,
quyền sở hữu bản cài, cấu hình, HTTPS và rollback vẫn bắt buộc. Ngân hàng bài,
hai tài khoản, bài làm, tiến độ và audio không được migrate/reset. Chỉ xác nhận
triển khai sau khi helper báo hoàn tất, app healthy và audit `complete.json`
ghi nhận model mới. Kiểm thử giả lập trong cloud không chứng minh tài khoản
VPS đã có quyền model hoặc một bài chấm thật đã thành công.
