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

## Xuống dòng và đối chiếu trích dẫn Writing

Đã tái hiện lỗi nhận diện đoạn: trước đây máy chủ chỉ tách đoạn khi có dòng trống, trong khi AI có thể xem một lần xuống dòng là đoạn tiếp theo. Một trích dẫn có thật trong đoạn thứ hai vì thế vẫn bị từ chối khi kiểm tra vị trí. Ảnh thông báo không xác định được chính xác validator nào đã từ chối phản hồi thực tế, vì trích dẫn rubric, câu gốc cần sửa, vị trí đoạn và bằng chứng của scorer dùng chung mã lỗi.

Máy chủ hiện tách các dòng có nội dung bằng LF/CRLF/CR hoặc dấu phân cách dòng Unicode, rồi gửi danh sách `{index,text}` cho bước trích dẫn. AI phải dùng đúng các chỉ số bắt đầu từ 0; ngắt dòng do textarea tự xuống hàng không tạo đoạn mới. Người học không cần chép lại bài hoặc chèn dòng trống để hợp với bộ kiểm tra. Bản nháp và nội dung gửi để chấm không được sửa ngữ pháp/chính tả tự động.

Đối chiếu Writing ưu tiên chuỗi nguyên văn. Nếu chỉ khác khoảng trắng, NFC hoặc dấu nháy cong/thẳng, bộ kiểm tra tìm lại đúng vị trí trong nguồn và trả chuỗi gốc từ bài đã lưu. Không bỏ từ, bỏ dấu câu, đổi hoa/thường, sửa chính tả/ngữ pháp, diễn giải lại, dùng ellipsis làm wildcard hoặc tìm gần đúng. Trích dẫn thuộc đoạn khác, Task khác hoặc chỉ có trong đề vẫn bị từ chối. Những kiểm tra nguyên văn của Speaking và sinh học liệu giữ nguyên.

Sau cập nhật có thể nộp lại cùng bản nháp; kết quả cũ không bị chấm lại tự động. Hai bước extractor/scorer vẫn giữ nguyên, không thêm lượt retry trả phí ngầm. Bước trích dẫn nhận thêm metadata đoạn; điểm, trọng số Task 2, giới hạn thời gian và quy tắc thi không thay đổi. Một phản hồi AI thực sự bịa dẫn chứng vẫn phải bị từ chối thay vì được gán điểm.

## Kiểm tra VPS

Chạy `python3 -B deploy/diagnose-writing.py` bằng root sau khi tải đúng commit và xác minh SHA256 helper. Helper chỉ kiểm tra đúng container IELTS, release/image, health trực tiếp và HTTPS, số lỗi đã lọc, cùng quyền đọc model OpenAI đang cấu hình. Không truy vấn database, chấm bài, tạo audio hoặc thay dịch vụ. Một GET model thành công chỉ chứng minh quyền đọc model; không chứng minh đủ tiền hay một bài viết đã chấm thành công.

Helper hoạt động riêng với app, không yêu cầu worker audio cũ phải dùng cùng image sau lần cập nhật chỉ ứng dụng. Bản cập nhật dùng [update-app.py](../deploy/update-app.py) vì ngân hàng bài, tài khoản và bản ghi không thay đổi. Chỉ receipt cập nhật và kiểm tra trên VPS mới xác nhận phiên bản mới đã được áp dụng.

Nếu thông báo mới cho biết quyền/hạn mức/model, xử lý cấu hình tài khoản nhà cung cấp tương ứng. Nếu AI trả nội dung không hợp lệ, có thể nộp lại chính bản nháp đang lưu. Nếu báo lỗi gateway hoặc dịch vụ/MongoDB, cần đối chiếu trạng thái runtime và log đã lọc. Không reset ngân hàng, lịch sử hoặc tạo lại audio để chữa lỗi Writing.
