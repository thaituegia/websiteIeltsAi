# Bài đã hoàn thành và làm lại

Kho bài tập và phòng thi thử hiển thị trạng thái hoàn thành của **người đang đăng nhập**, theo đúng chế độ luyện hoặc thi. Bấm bài đã hoàn thành mở lựa chọn **Xem kết quả gần nhất** hoặc **Làm lại**; đóng hộp thoại không tạo lượt mới.

Kết quả gần nhất là lượt hợp lệ đã nộp gần nhất, không phải điểm cao nhất. Lượt làm lại bắt đầu với câu trả lời trống hoặc tiếp tục bản nháp đang có. Chỉ sau khi nộp, kết quả mới trở thành kết quả gần nhất; bản nháp và lượt bị hủy không thay kết quả đã lưu. Những lượt đã nộp trước vẫn được giữ trong lịch sử, cùng đáp án, phản hồi và bản ghi của từng lượt. Writing/Speaking chưa có điểm AI vẫn hiện rõ tình trạng chờ chấm.

Buổi học đã hoàn thành trên lộ trình cũng có lựa chọn xem kết quả và làm lại. Làm lại không thu hồi mốc đã đạt hoặc thay kết quả của người đồng hành. Xác nhận hoàn thành bằng một bài mới hợp lệ cập nhật bằng chứng lần làm mới nhất, giữ thời điểm đạt mốc đầu tiên. Thi Duo Gate và thi nâng band tiếp tục dùng quy trình đánh giá/phòng thi riêng; nút làm lại bài thường không thay kết quả đánh giá chung.

Listening vẫn kiểm tra audio có sẵn trước khi bắt đầu. Thi thử làm lại vẫn phải xác nhận quy tắc giám sát; thời gian, giới hạn nghe và quy tắc đổi đề sau lượt bị hủy được giữ.

## API

- `GET /api/content?mode=practice|exam`: kết quả thư viện có `progress` theo ID học liệu trên trang hiện tại.
- `GET /api/content/:id/progress?mode=practice|exam`: trả `{progress}` của riêng người đang đăng nhập.
- `ContentProgress` gồm `latestAttempt` (tóm tắt lượt đã nộp gần nhất hoặc `null`), `activeAttemptId` (bản nháp hoặc `null`) và `completedCount`.

Các API tiến độ chỉ trả thông tin tóm tắt, dùng `Cache-Control: private, no-store`; không trả câu trả lời, đáp án, transcript hoặc kết quả người còn lại. Bắt đầu/làm lại tiếp tục dùng `POST /api/attempts`; không sửa hoặc xóa lượt đã nộp.

Không cần migration, reset ngân hàng, tạo lại audio hoặc thay secrets. Cập nhật chỉ ứng dụng bằng [quy trình triển khai](../deploy/README.md). Ước lượng kỹ năng vẫn áp dụng quy tắc bằng chứng riêng đang có; nhãn kết quả gần nhất không biến nhiều lần làm cùng một đề thành các bằng chứng độc lập.
