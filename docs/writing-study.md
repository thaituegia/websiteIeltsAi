# Bài mẫu và hướng dẫn Writing bằng tiếng Việt

Sau khi nộp bài Writing, ngay dưới vùng đề bài/bài viết có **Bài mẫu tham khảo** và **Hướng dẫn làm bài bằng tiếng Việt**. Chuyển tab Task 1/Task 2 để xem đúng mẫu và hướng dẫn của phần đó; nội dung không còn bị lặp ở cuối khối chấm điểm. Speaking giữ màn hình bài mẫu hiện có.

Ngân hàng hiện có 306 bài Writing (252 bài luyện, 54 đề thi), gồm 360 Tasks đã có bài mẫu. Bản cập nhật dùng nguyên các mẫu đó, không tạo lại đề hoặc gọi AI trả phí. Mẫu là ví dụ để học cách triển khai, không phải đáp án duy nhất và không bảo đảm một mức band. Việc chấm điểm AI vẫn theo cấu hình hiện tại.

Hướng dẫn gồm:

- Nhận diện yêu cầu đề, dạng bài và các chi tiết cần kiểm tra trong nguồn.
- Các bước đọc đề, chọn ý/đặc điểm, lập dàn ý, viết và rà soát.
- Dàn ý đối chiếu từng đoạn của chính bài mẫu, với trích đoạn nguyên văn.
- Cụm từ thực sự xuất hiện trong mẫu, kèm giải thích tiếng Việt.
- Checklist tự soát và các lỗi thường gặp với dạng bài đó.

Task 1 có gợi ý chia 20 phút và tối thiểu 150 từ; Task 2 có gợi ý 40 phút và tối thiểu 250 từ. Đây là phân bổ thời gian làm bài IELTS để tham khảo, không thay đổi deadline hoặc thời gian đã lưu của lượt làm. Hướng dẫn phân biệt biểu đồ/bảng/bản đồ/quy trình, thư General Training và các yêu cầu bài luận. Chi tiết nguồn chỉ được nêu khi nguồn và bài mẫu có thể đối chiếu; không tự thêm nguyên nhân, số liệu hay vị trí ngoài đề.

Trước nộp chỉ hiện thông báo khóa. Bài đang làm hoặc đã bị hủy không nhận bài mẫu/hướng dẫn trong API, kể cả khi bản ghi cũ có feedback. Bài mẫu tiếp tục hỗ trợ chọn từ, lưu từ và tra phiên âm/nghĩa khi xem lại. Hướng dẫn tiếng Việt và các trích đoạn dàn ý hiển thị dạng văn bản, không mở thêm nguồn tra từ ngoài phạm vi của bài.

API giữ nguyên các đường dẫn hiện có. `Feedback.writingGuides` là mảng hướng dẫn gắn `sectionId`, được lưu cùng kết quả nộp mới; các bài mẫu trong `Feedback.referenceAnswers` được giữ nguyên. Khi mở bài cũ chưa có hướng dẫn, máy chủ bổ sung vào response để xem, không ghi đè lịch sử. Nếu nguồn hoặc mẫu đã được sửa và không chứng minh được sự khớp nhau, phần hướng dẫn báo rõ giới hạn và chỉ đưa cách đọc mẫu chung, không áp số liệu của đề mới vào mẫu cũ.

Không cần seed, migration, reset hoặc nâng ngân hàng. Dùng updater app-only, giữ nguyên tài khoản, bài làm, điểm, lộ trình, sổ từ, ghi âm và audio đã tạo. Build/kiểm tra trong cloud không đồng nghĩa website trên VPS đã được cập nhật.
