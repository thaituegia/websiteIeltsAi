# Chẩn đoán lỗi nộp Writing

Luồng nộp lưu bản nháp trước khi gọi hai bước trích dẫn bằng chứng và chấm rubric. Phản hồi AI thiếu cấu trúc, thiếu tiêu chí hoặc chứa bằng chứng không có trong bài vẫn bị từ chối; không thay bằng điểm suy đoán. Bài đang làm và nội dung đã lưu được giữ để người học thử nộp lại.

Giao diện trước đây thay mọi HTTP 502 bằng một thông báo gateway chung. Phiên bản mới phân biệt lỗi AI có mã hữu hạn với lỗi gateway không xác định, hiển thị lý do an toàn cho người học:

| Mã | Ý nghĩa |
| --- | --- |
| `AI_PROVIDER_AUTH` | Key/project không có quyền gọi API. |
| `AI_PROVIDER_QUOTA` | Nhà cung cấp xác nhận hết hạn mức hoặc số dư. |
| `AI_PROVIDER_RATE_LIMIT` | Nhà cung cấp giới hạn tốc độ; chưa có bằng chứng hết số dư. |
| `AI_MODEL_UNAVAILABLE` | Model không khả dụng hoặc chưa được cấp quyền. |
| `AI_PROVIDER_TIMEOUT` / `AI_PROVIDER_NETWORK` | Hết thời gian hoặc lỗi kết nối nhà cung cấp. |
| `AI_PROVIDER_UNAVAILABLE` | Nhà cung cấp tạm thời từ chối xử lý yêu cầu. |
| `AI_RESPONSE_INVALID` | JSON, cấu trúc, task hoặc bộ tiêu chí không hợp lệ. |
| `AI_EVIDENCE_INVALID` | Trích dẫn không có nguyên văn trong bài viết. |

Response chứa `{error,code}`. Log `AI grading failure:` chỉ lưu mã, HTTP status và loại route cố định, không có key, nội dung bài, ID người học hoặc phản hồi thô của nhà cung cấp. HTTP 502 không có mã được nhận diện vẫn dùng thông báo gateway chung. Các mã này cũng dùng cho những adapter AI dùng chung; không thay model, tiêu chí hay số lần tự gọi chấm.

## Kiểm tra VPS

Chạy `python3 -B deploy/diagnose-writing.py` bằng root sau khi tải đúng commit và xác minh SHA256 helper. Helper chỉ kiểm tra đúng container IELTS, release/image, health trực tiếp và HTTPS, số lỗi đã lọc, cùng quyền đọc model OpenAI đang cấu hình. Không truy vấn database, chấm bài, tạo audio hoặc thay dịch vụ. Một GET model thành công chỉ chứng minh quyền đọc model; không chứng minh đủ tiền hay một bài viết đã chấm thành công.

Helper hoạt động riêng với app, không yêu cầu worker audio cũ phải dùng cùng image sau lần cập nhật chỉ ứng dụng. Bản cập nhật dùng [update-app.py](../deploy/update-app.py) vì ngân hàng bài, tài khoản và bản ghi không thay đổi. Chỉ receipt cập nhật và kiểm tra trên VPS mới xác nhận phiên bản mới đã được áp dụng.

Nếu thông báo mới cho biết quyền/hạn mức/model, xử lý cấu hình tài khoản nhà cung cấp tương ứng. Nếu AI trả nội dung không hợp lệ, có thể nộp lại chính bản nháp đang lưu. Nếu báo lỗi gateway hoặc dịch vụ/MongoDB, cần đối chiếu trạng thái runtime và log đã lọc. Không reset ngân hàng, lịch sử hoặc tạo lại audio để chữa lỗi Writing.
