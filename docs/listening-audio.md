# Bài nghe nhiều nhân vật

Listening trong kho và placement dùng chung bộ tách script. Đối thoại có cấu trúc được ưu tiên; script chữ nhận diện nhãn người nói như `Teacher:`, `Pupil:`, tên riêng trong hội thoại và `Speaker 1:`. Chỉ lời nói được gửi tới dịch vụ tạo audio. Bộ tách giữ các nội dung có ý nghĩa như giờ, URL, lời tự giới thiệu và câu trích dẫn. Tiêu đề phần không được đọc.

Trong một cảnh, các nhân vật dùng các giọng khác nhau; nhân vật xuất hiện lại giữ giọng cũ. Giọng được chọn ổn định theo cảnh và nhân vật, có sự đa dạng giữa các bài. Accent chỉ lấy từ dữ liệu tác giả; không suy đoán giới tính hoặc quốc tịch từ tên. Lời đọc của giảng viên, người phục vụ và học sinh có hướng dẫn ngữ điệu phù hợp vai trò.

## Nhà cung cấp và bộ nhớ đệm

- OpenAI được ưu tiên khi có key server: `gpt-4o-mini-tts`, 11 giọng chuẩn. Từng lượt thoại được tạo riêng rồi ghép thành WAV mono 16 kHz với khoảng nghỉ khi đổi nhân vật.
- ElevenLabs được dùng khi không có OpenAI, có key và ba voice IDs khác nhau: `text-to-dialogue`, mặc định `eleven_v3`. Các cảnh độc lập có thể dùng lại ba giọng, nhân vật trong cùng cảnh vẫn có giọng riêng.
- Khi chưa cấu hình nhà cung cấp, trình duyệt chọn các giọng tiếng Anh có trên thiết bị. Nếu chỉ có một giọng, thông báo rõ giới hạn và thay đổi nhẹ tốc độ/cao độ; không coi đây là nhiều giọng AI.

Audio được tạo theo yêu cầu, không tạo trước toàn bộ ngân hàng. Các yêu cầu cùng script dùng lại cache; thay script, model, giọng hoặc phiên bản tạo audio sẽ tạo cache mới. Metadata không chứa API key hoặc thông tin người học. Cache dùng `speech_audio_jobs` và GridFS `speech_audio.files`/`speech_audio.chunks`, tách biệt với bản ghi Speaking riêng của người dùng. Việc mở ứng dụng hoặc xem health không ghi cache hay gọi dịch vụ trả phí.

Mỗi tiến trình chỉ chạy một tác vụ tổng hợp cùng lúc. Một script giới hạn 40.000 ký tự và 240 lượt thoại, kết quả tối đa 64 MiB; mỗi yêu cầu nhà cung cấp có timeout 120 giây, toàn tác vụ tối đa 15 phút. Tạo lần đầu có thể mất thời gian, giao diện hiển thị trạng thái chuẩn bị. Lỗi nhà cung cấp được báo để thử lại, không âm thầm chuyển sang giọng khác.

## Quyền truy cập và lượt nghe

`POST /api/attempts/:id/listening-audio` dùng lượt làm của chính người đăng nhập; `POST /api/placement/:id/audio` nhận `questionId` và chỉ phát câu hiện tại. Backend kiểm tra lại quyền, tình trạng bài, thời gian và khóa thi sau khi audio được tạo. Chế độ Exam chỉ nhận audio một lần; lỗi tạo hoặc ngắt kết nối trước khi nhận audio không tiêu hao lượt. Đổi câu hoặc rời bài hủy phần phát đang chờ trên trình duyệt.

Response có `X-Speech-Provider`, `X-Speech-Voices` (số giọng thực tế dùng) và `X-Speech-Cache`; health có `services.speech` mô tả cấu hình, không chứng minh nhà cung cấp đã hoạt động live. Route `POST /api/content/:id/audio` cũ được giữ để tương thích. Speaking hiện dùng bản ghi của người học, không dùng bộ đọc hội thoại; luồng ghi âm, nhận dạng và chấm điểm được giữ nguyên.

## Kiểm tra

Các tests `speech-script`, `browser-speech`, `speech-audio`, `listeningspeech-api` kiểm tra nguyên văn lời thoại trên ngân hàng hiện tại, phân vai, chia đoạn, cache, lỗi nhà cung cấp, quyền truy cập, hết giờ, nghe một lần và ngắt kết nối. Tests trình duyệt `listening-voices.spec.ts` kiểm tra kho bài và placement trên desktop/mobile. Transport và thiết bị audio của tests được kiểm soát; chúng không gọi dịch vụ trả phí. Các tests Mongo dùng database tạm, không dùng dữ liệu người học.
