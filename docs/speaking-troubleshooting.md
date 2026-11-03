# Speaking: cấu trúc đánh giá âm thanh và thử lại bản ghi

Thông báo **Đánh giá âm thanh không đúng cấu trúc** xảy ra sau khi đã nhận dạng lời nói và đọc JSON từ bước chấm audio. Ảnh màn hình không chỉ ra trường nào trong phản hồi thực tế bị sai. Kiểm thử đã tái hiện thông báo khi model chỉ bỏ `confidence` hoặc `corrections`, hoặc trả `observations:null` trong một kết quả chủ động không chấm điểm âm học.

Bộ đọc riêng của audio hiện cho `confidence` bị thiếu thành `null` (chưa biết), và các danh sách `corrections`/`observations` bị thiếu hoặc null thành `[]`. Đây chỉ là thông tin phụ: bốn tên tiêu chí vẫn phải xuất hiện đúng một lần; `speechDetected`, `summary`, điểm hoặc null, nhận xét và mảng dẫn chứng vẫn phải có. Không đổi chuỗi thành số, phần trăm thành điểm, làm tròn điểm sai bước, đoán điểm còn thiếu hoặc bỏ tiêu chí lỗi.

Điểm chỉ nhận 0–9 với bước 0,5. Mỗi tiêu chí có điểm vẫn cần trích dẫn có thật trong transcript; phát âm và độ trôi chảy còn cần quan sát âm học kèm thời gian nằm trong bản ghi. Thiếu bằng chứng thì không có điểm đạt. Không suy ra phát âm từ văn bản. Ghi âm không đủ hoặc không có lời nói tiếp tục không có toàn band Speaking.

Prompt audio nhận chính JSON schema làm hợp đồng đầu ra, thay cho ví dụ mô tả rút gọn. Không thêm chế độ `response_format` chưa xác minh model hỗ trợ, không gọi thêm AI để tự sửa JSON hoặc thử lại ngầm. Khi cấu trúc vẫn sai, API/SSE trả `AI_RESPONSE_INVALID` cùng thông báo giữ bản ghi. Log `Speaking audio response rejected:` chỉ chứa mã và danh mục trường được cho phép, không có transcript, âm thanh, thông tin tài khoản hay phản hồi thô của nhà cung cấp.

## Thử lại

Máy chủ giữ WAV và transcript Whisper trên metadata của đúng file GridFS trước khi chấm. Thử lại bằng `POST /api/attempts/:id/speaking` không kèm file sẽ đọc bản ghi riêng đã lưu và dùng transcript nhận dạng của đúng file đó. Model chấm vẫn nhận chính âm thanh; chỉ bước STT được bỏ qua nếu đã có nhận dạng hợp lệ. Trường `recognizedTranscript` do trình duyệt gửi không được tin dùng. Regrade Duo cũng dùng nguồn nhận dạng gắn file đã được máy chủ kiểm tra.

Giao diện giữ Blob để nghe lại và chỉ coi Blob được lưu khi đã nhận một sự kiện xử lý từ server sau khi con trỏ file được công bố. Thử lại cùng Blob đã được xác nhận không tải lại rồi upload audio thêm lần nữa. Sau reload, trang gửi yêu cầu dùng bản ghi server; file mới luôn được upload và phải nhận dạng mới. Nếu upload mất kết nối trước xác nhận, Blob mới vẫn được giữ để gửi lại, kể cả khi đã có một file cũ trên server. Transcript được khôi phục sau lỗi khi người dùng chưa có chỉnh sửa mới.

Điều này không tạo phí retry tự động. Người dùng chủ động chấm lại vẫn phát sinh một lần gọi chấm âm thanh; STT được dùng lại khi hợp lệ. Kết quả hoàn thành trước đó không bị chấm lại hàng loạt. Quy tắc thi, thời hạn, lease và phạm vi hai tài khoản giữ nguyên.

Bản cập nhật không cần migration/reset, thay ngân hàng hoặc tạo lại giọng Listening. Dùng helper app-only hiện có, giữ database và audio. Build/tests cloud không chứng minh bản sửa đã chạy trên VPS hoặc chất lượng chấm live; cần receipt triển khai và một lần nộp lại bản ghi thật của người dùng để xác nhận.
