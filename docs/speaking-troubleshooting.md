# Speaking: cấu trúc đánh giá âm thanh và thử lại bản ghi

Thông báo **Đánh giá âm thanh không đúng cấu trúc** xảy ra sau khi đã nhận dạng lời nói và đọc JSON từ bước chấm audio. Ảnh màn hình không chỉ ra trường nào trong phản hồi thực tế bị sai. Kiểm thử đã tái hiện thông báo khi model chỉ bỏ `confidence` hoặc `corrections`, hoặc trả `observations:null` trong một kết quả chủ động không chấm điểm âm học.

Bộ đọc riêng của audio hiện cho `confidence` bị thiếu thành `null` (chưa biết), và các danh sách `corrections`/`observations` bị thiếu hoặc null thành `[]`. Đây chỉ là thông tin phụ: bốn tên tiêu chí vẫn phải xuất hiện đúng một lần; `speechDetected`, `summary`, điểm hoặc null, nhận xét và mảng dẫn chứng vẫn phải có. Không đổi chuỗi thành số, phần trăm thành điểm, làm tròn điểm sai bước, đoán điểm còn thiếu hoặc bỏ tiêu chí lỗi.

Log VPS sau cập nhật xác định lỗi ở `evidence`; các dòng này không chứa payload nên chưa xác nhận được model trả chuỗi, đối tượng hay bỏ trường. Bộ đọc nhận các biểu diễn trích dẫn rõ nghĩa: một chuỗi, đối tượng có `quote`/`text`, hoặc danh sách các dạng đó; kết quả lưu vẫn là `string[]`. Không tách câu theo dấu, diễn giải lại nội dung, loại phần tử sai hoặc chọn tùy tiện giữa hai trường `quote`/`text` mâu thuẫn. Giới hạn độ dài/số lượng và kiểm tra nguyên văn transcript giữ nguyên.

Tiêu chí không được chấm (`band:null`) có thể có dẫn chứng trống. Nếu phát âm/độ trôi chảy thiếu dẫn chứng riêng nhưng đã có quan sát âm học của chính tiêu chí đó, chỉ các câu `quote` trong các quan sát ấy được dùng lại. Mọi câu trích và mốc thời gian vẫn phải qua kiểm tra trước khi công bố điểm. Không dùng quan sát tiêu chí khác để bù bằng chứng, không thay một câu sai đã được trả về bằng câu khác, và không tạo dẫn chứng cho điểm ngôn ngữ còn thiếu hỗ trợ.

Điểm chỉ nhận 0–9 với bước 0,5. Mỗi tiêu chí có điểm vẫn cần trích dẫn có thật trong transcript; phát âm và độ trôi chảy còn cần quan sát âm học kèm thời gian nằm trong bản ghi. Thiếu bằng chứng thì không có điểm đạt. Không suy ra phát âm từ văn bản. Ghi âm không đủ hoặc không có lời nói tiếp tục không có toàn band Speaking.

Prompt audio nhận chính JSON schema làm hợp đồng đầu ra và nhấn mạnh dẫn chứng phải là mảng trích nguyên văn từ transcript đã cung cấp. Không thêm chế độ `response_format` chưa xác minh model hỗ trợ, không gọi thêm AI để tự sửa JSON hoặc thử lại ngầm. Khi cấu trúc vẫn sai, API/SSE trả `AI_RESPONSE_INVALID` cùng thông báo giữ bản ghi. Log `Speaking audio response rejected:` chỉ chứa mã, danh mục trường và metadata kiểu dữ liệu hữu hạn cho tối đa bốn tiêu chí; không có transcript, âm thanh, thông tin tài khoản, giá trị hay khóa tùy ý từ phản hồi nhà cung cấp.

## Thử lại

Máy chủ giữ WAV và transcript Whisper trên metadata của đúng file GridFS trước khi chấm. Thử lại bằng `POST /api/attempts/:id/speaking` không kèm file sẽ đọc bản ghi riêng đã lưu và dùng transcript nhận dạng của đúng file đó. Model chấm vẫn nhận chính âm thanh; chỉ bước STT được bỏ qua nếu đã có nhận dạng hợp lệ. Trường `recognizedTranscript` do trình duyệt gửi không được tin dùng. Regrade Duo cũng dùng nguồn nhận dạng gắn file đã được máy chủ kiểm tra.

Giao diện giữ Blob để nghe lại và chỉ coi Blob được lưu khi đã nhận một sự kiện xử lý từ server sau khi con trỏ file được công bố. Thử lại cùng Blob đã được xác nhận không tải lại rồi upload audio thêm lần nữa. Sau reload, trang gửi yêu cầu dùng bản ghi server; file mới luôn được upload và phải nhận dạng mới. Nếu upload mất kết nối trước xác nhận, Blob mới vẫn được giữ để gửi lại, kể cả khi đã có một file cũ trên server. Transcript được khôi phục sau lỗi khi người dùng chưa có chỉnh sửa mới.

Điều này không tạo phí retry tự động. Người dùng chủ động chấm lại vẫn phát sinh một lần gọi chấm âm thanh; STT được dùng lại khi hợp lệ. Kết quả hoàn thành trước đó không bị chấm lại hàng loạt. Quy tắc thi, thời hạn, lease và phạm vi hai tài khoản giữ nguyên.

Bản cập nhật không cần migration/reset, thay ngân hàng hoặc tạo lại giọng Listening. Dùng helper app-only hiện có, giữ database và audio. Build/tests cloud không chứng minh bản sửa đã chạy trên VPS hoặc chất lượng chấm live; cần receipt triển khai và một lần nộp lại bản ghi thật của người dùng để xác nhận.
