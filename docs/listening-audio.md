# Bài nghe nhiều nhân vật

Listening trong kho và placement dùng chung bộ tách script. Đối thoại có cấu trúc được ưu tiên; script chữ nhận diện nhãn người nói như `Teacher:`, `Pupil:`, tên riêng trong hội thoại và `Speaker 1:`. Chỉ lời nói được gửi tới dịch vụ tạo audio. Bộ tách giữ các nội dung có ý nghĩa như giờ, URL, lời tự giới thiệu và câu trích dẫn. Tiêu đề phần không được đọc.

Trong một cảnh, các nhân vật dùng các giọng khác nhau; nhân vật xuất hiện lại giữ giọng cũ. Giọng được chọn ổn định theo nội dung lời thoại và nhân vật, có sự đa dạng giữa các bài. Đổi ID đề/phần hoặc ghép lại các phần không làm đổi giọng hay tạo lại audio. Accent chỉ lấy từ dữ liệu tác giả; không suy đoán giới tính hoặc quốc tịch từ tên. Lời đọc của giảng viên, người phục vụ và học sinh có hướng dẫn ngữ điệu phù hợp vai trò.

## Nhà cung cấp và bộ nhớ đệm

- OpenAI được ưu tiên khi có key server: `gpt-4o-mini-tts`, 11 giọng chuẩn. Từng lượt thoại được tạo riêng rồi ghép thành WAV mono 16 kHz với khoảng nghỉ khi đổi nhân vật.
- ElevenLabs được dùng khi không có OpenAI, có key và ba voice IDs khác nhau: `text-to-dialogue`, mặc định `eleven_v3`. Các cảnh độc lập có thể dùng lại ba giọng, nhân vật trong cùng cảnh vẫn có giọng riêng.
- Khi chưa cấu hình nhà cung cấp, trình duyệt chọn các giọng tiếng Anh có trên thiết bị. Nếu chỉ có một giọng, thông báo rõ giới hạn và thay đổi nhẹ tốc độ/cao độ; không coi đây là nhiều giọng AI.

Theo yêu cầu tạo trước của chủ website, worker `server/speech-prewarm-cli.ts` chuẩn bị cả ngân hàng: 192 phần của 72 bài luyện/30 đề Listening và 240 câu Listening đầu vào, tổng 432 đoạn độc lập. Đề đầy đủ hoặc đề thay thế ghép các đoạn có sẵn; không cần tạo mọi tổ hợp đề. Worker ưu tiên bài luyện band thấp, tiếp theo đề và học liệu tùy chỉnh, rồi các câu đầu vào. Học liệu mới được quét ở lượt sau.

Các script giống nhau dùng lại cache; thay lời thoại, accent, model, giọng hoặc phiên bản audio tạo cache mới. Mỗi lượt thoại hoàn tất được lưu bền vững, nên lỗi ở lượt sau không phải trả phí tạo lại đoạn đã xong. Metadata không chứa API key, script hay danh tính người học. Cache dùng `speech_audio_jobs` và GridFS `speech_audio.files`/`speech_audio.chunks`, tách biệt với bản ghi Speaking. `speech_bank_prewarm` chỉ giữ tiến độ/hash và mã lỗi đã lọc. Các bản cache cũ được giữ; không xóa bài làm hoặc bản ghi âm.

Mỗi tiến trình chỉ tổng hợp một phần cùng lúc, tối đa hai yêu cầu OpenAI đồng thời. Một script giới hạn 40.000 ký tự và 240 lượt thoại, kết quả tối đa 64 MiB; timeout mỗi yêu cầu 120 giây, một tác vụ 15 phút sau khi đến lượt chạy. Worker retry có backoff khi dịch vụ tạm lỗi/rate-limit, giữ các lượt đã xong, và dừng gửi yêu cầu khi lỗi quyền/hết hạn mức. Chuẩn bị toàn bộ kho mất thời gian; việc này chạy trước bài học bằng key API server, có chi phí nhà cung cấp.

Chạy `--inspect` chỉ đọc trạng thái; `--once --max-clips 32` chuẩn bị một lượt; `--watch --max-clips 32 --max-retries 3 --interval-seconds 60` tiếp tục quét. Chỉ dùng `--resume` sau khi xử lý lỗi quyền/hạn mức. CLI yêu cầu đúng origin production và cấu hình hai tài khoản riêng để mở key đã mã hóa; không seed hoặc ghi vào dữ liệu người học.

## Quyền truy cập và lượt nghe

`POST /api/attempts/:id/listening-audio` dùng lượt làm của chính người đăng nhập; `POST /api/placement/:id/audio` nhận `questionId` và chỉ phát câu hiện tại. Hai route và route audio cũ chỉ đọc cache, không tạo job, không gọi OpenAI/ElevenLabs và không chờ hàng đợi. Thiếu audio trả 409 ngay; backend không bắt đầu bài Listening/placement/Gate/Ready nâng band trước khi đủ audio. Readiness cũng được kiểm tra trước hộp thoại bắt đầu trên giao diện. Placement cần đủ tập câu Listening mà bộ chọn thích ứng có thể dùng.

Backend kiểm tra lại quyền, tình trạng bài, thời gian và khóa thi sau khi tải audio. Exam nhận audio một lần; lỗi tải hoặc ngắt kết nối trước khi nhận không tiêu hao lượt. Đổi câu hoặc rời bài hủy phần phát đang chờ trên trình duyệt. Cache hỏng/đọc lỗi không âm thầm gọi AI tạo lại trong bài thi.

Kho bài và kiểm tra audio trên giao diện có giới hạn 10 giây, hiển thị trạng thái/lỗi và nút thử lại cạnh bài vừa chọn. Đổi bộ lọc hoặc rời trang hủy yêu cầu kiểm tra cũ. Các truy vấn đọc xác thực, kho bài, học liệu và metadata audio dùng MongoDB CSOT 5 giây; tải từng đoạn GridFS trong lượt nghe có giới hạn 20 giây. Lỗi đọc trả 503 và giữ audio đã lưu; không gọi AI để bù. Không áp giới hạn 10 giây cho việc nộp bài/chấm AI. Hộp quy định thi được giữ khi kiểm tra lại audio tạm lỗi sau xác nhận; chưa tạo lượt làm hoặc đồng hồ cho đến khi đủ audio.

Response có `X-Speech-Provider`, `X-Speech-Voices` (số giọng thực tế dùng) và `X-Speech-Cache: hit`; health có `services.speech` mô tả cấu hình. Các GET `/api/content/:id/listening-audio/readiness`, `/api/placement/audio/readiness`, `/api/listening-audio/status` cần đăng nhập, chỉ đọc trạng thái/count; không lộ lời thoại/đáp án hoặc tạo audio. Nút kiểm tra lại trên giao diện chỉ gọi GET. Route `POST /api/content/:id/audio` cũ vẫn tương thích và chỉ đọc cache. Speaking ghi âm/nhận dạng/chấm điểm được giữ nguyên.

## Triển khai

`deploy/run-speech-update.py` nhận commit và SHA256 archive đã ghim, gọi updater giữ dữ liệu hiện tại rồi tạo container worker riêng từ cùng image app. Worker có 384 MiB RAM, không thêm swap, 0,25 CPU, filesystem chỉ đọc, không capabilities, không mở cổng và log có giới hạn. Chỉ worker tham gia cả mạng dữ liệu riêng và mạng web để gọi nhà cung cấp. Cấu hình/key nằm trong file riêng hoặc được mở trong bộ nhớ; không đưa key vào lệnh hoặc frontend. Không reset band/tài khoản/tiến độ. Lệnh không khẳng định cả kho đã hoàn tất ngay: theo dõi log/count, bài nào đủ audio sẽ mở, toàn bộ kho tiếp tục được chuẩn bị.

Nếu website báo 502, chạy `python3 deploy/diagnose-listening.py` bằng root trên VPS sau khi lấy đúng phiên bản script. Lệnh mặc định chỉ đọc, xác minh đúng project và báo trạng thái/OOM/restart/tài nguyên của app, MongoDB, proxy, worker; kiểm tra health trực tiếp và HTTPS qua Nginx; thống kê nhóm lỗi/route từ log riêng. Không in key, cookie, URL chứa ID bài làm hay log nguyên văn. Health 200 không chứng minh route mở bài hoạt động hoặc không có lỗi gián đoạn trước đó. Thiếu audio có trạng thái pending/409, không tự gây 502. Chỉ dùng `--pause-worker` khi cần kiểm tra ảnh hưởng tài nguyên: dừng đúng worker đã xác minh, giữ container/cache/tài khoản/tiến độ và các project khác.

## Kiểm tra

Các tests `speech-script`, `browser-speech`, `speech-audio`, `listeningspeech-api` kiểm tra nguyên văn lời thoại trên ngân hàng hiện tại, phân vai, chia đoạn, cache, lỗi nhà cung cấp, quyền truy cập, hết giờ, nghe một lần và ngắt kết nối. Tests trình duyệt `listening-voices.spec.ts` kiểm tra kho bài và placement trên desktop/mobile. Transport và thiết bị audio của tests được kiểm soát; chúng không gọi dịch vụ trả phí. Các tests Mongo dùng database tạm, không dùng dữ liệu người học.
