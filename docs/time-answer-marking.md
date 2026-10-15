# Chấm câu điền giờ

Câu nhập đáp án (`type: text`) chấp nhận các cách viết cùng một giờ: `6:30`, `06:30`, `6.30`, `six thirty`, `half past six`, `half six`. Các dạng `quarter past`, `quarter to`, số phút `past/to`, `o'clock`, `noon`, `midnight` và AM/PM cũng được nhận diện. Trang xem lại giữ nguyên câu người học đã nhập và bổ sung một số biến thể minh họa cạnh đáp án gốc.

Đáp án có AM/PM, buổi trong ngày hoặc giờ 24 tiếng rõ ràng phải khớp đúng buổi. Ví dụ `18:30` nhận `six thirty pm`, `half past six in the evening`, `eighteen thirty`; không nhận `six thirty am` hoặc `half past six` thiếu buổi. Nếu tác giả muốn chấp nhận cách thiếu buổi, có thể khai báo thêm `6:30` trong `acceptedAnswers`. Đáp án gốc không ghi buổi như `6:30` chỉ xác định giờ trên mặt đồng hồ, nên nhận cả cách viết cùng giờ có AM/PM. Câu hỏi ghi rõ `in the morning`, `in the afternoon`, `in the evening` hoặc AM/PM sẽ ràng buộc buổi và có thể cung cấp buổi cho cách viết thiếu AM/PM; không suy đoán từ toàn bộ đoạn văn hay câu hỏi nhắc nhiều buổi. `at night` được hiểu là AM từ 12 đến 5 giờ và PM từ 6 đến 11 giờ.

Số nhìn giống số thập phân (`6.30`) hoặc chỉ một giờ (`6`, `six`) chỉ được hiểu là giờ khi câu hỏi có từ chỉ thời gian như `time`, `arrival`, `departure`, `when`. Giá tiền, số phòng, số lượng và thời lượng vẫn chấm theo đáp án khai báo; không tự chuyển tất cả số hay từ đồng nghĩa. Cách viết gần đúng, khoảng giờ, nhiều phương án hoặc thêm câu giải thích không được coi là một giờ chính xác.

Một cách viết bằng chữ dài hơn được dùng giới hạn từ/số của đáp án giờ gốc hợp lệ, nên `half past six` vẫn đúng nếu đáp án `6:30` nằm trong giới hạn đề. Ngoại lệ này chỉ áp dụng cho giờ khớp hoàn toàn; giới hạn các câu khác không thay đổi. Đây là quy tắc luyện tập của website, không phải cam kết quy tắc chấm của kỳ thi IELTS thật.

Thay đổi không sửa ngân hàng đề, tài khoản, điểm cũ hoặc lịch sử đã lưu. Chỉ các lần chấm mới áp dụng quy tắc giờ; kết quả đã chấm trước đó giữ nguyên.
