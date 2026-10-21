# Sổ từ trong bài học và bài thi

Trong bài học, đề thi hoặc bài đầu vào, bật **Chọn từ để lưu** rồi chạm hoặc bấm vào một từ tiếng Anh trong nội dung đang hiển thị. Thẻ nhỏ hiện ngay trong trang; chọn **Lưu vào sổ từ của tôi** để lưu từ và câu gốc vào sổ riêng của người đang đăng nhập. Khi dùng bàn phím, nhấn Enter hoặc Space trên từ; Escape đóng thẻ.

Trong lúc làm bài, thẻ chỉ cho phép lưu từ. Nghĩa mở sau khi bài đã nộp và chấm xong; với bài đầu vào, cần hoàn thành toàn bộ bài. Thao tác chọn/lưu từ không đổi đáp án, không mở cửa sổ mới và không đặt lại đồng hồ. Transcript đang bị ẩn của bài nghe vẫn được giữ kín.

Khi xem lại bài đã nộp, bật **Chọn từ để xem nghĩa** rồi chọn từ để xem nghĩa tiếng Việt theo câu gốc ngay trong trang. Có thể lưu thêm từ ở đây. Khi dịch gặp gián đoạn, từ đã lưu vẫn còn và có nút thử lại. Mỗi người có sổ riêng, không truy cập bài hoặc thẻ từ của người còn lại.

Ở **Từ vựng → Từ đã lưu**, từ chưa được dịch có nhãn **Chờ nghĩa sau nộp bài**, kèm **Mở bài nguồn** và **Dịch nghĩa**. Từ chờ nghĩa chưa vào lượt ôn flashcard. Sau khi dịch từ ở đúng ngữ cảnh đã lưu, thẻ được bổ sung nghĩa; lịch ôn và lịch sử đã có vẫn được giữ. Lưu cùng từ nhiều lần chỉ tạo một thẻ; chọn lưu ở câu khác có thể cập nhật câu gốc của thẻ còn chờ nghĩa.

Máy chủ chỉ nhận một từ và câu đã kiểm tra trong bài của người dùng. Khi câu khớp ví dụ trong ngân hàng từ vựng, nghĩa có sẵn được dùng lại; ngữ cảnh khác được dịch bằng OpenAI `gpt-4o-mini` qua khóa API riêng đang cấu hình trên máy chủ. Không đưa khóa vào mã giao diện. Nếu nhà cung cấp chưa cấu hình hoặc không đáp ứng, hệ thống báo thử lại và giữ từ đã lưu. Nghĩa AI có thể cần kiểm tra lại khi ôn.

API lưu: `POST /api/attempts/:id/words` hoặc `/api/placement/:id/words`, body `{word, context?, sectionIndex?, questionId?}`. Response chỉ có `{saved:{cardId,word,alreadySaved}}`, không có nghĩa hay đáp án. Dịch dùng đường dẫn tương ứng thêm `/translate`; máy chủ chỉ trả nghĩa cho bài thuộc người dùng và đã hoàn thành hợp lệ. Lượt bị hủy không được tra nghĩa. `sectionIndex` dùng cho lượt luyện/thi; `questionId` dùng cho bài đầu vào.

Bản cập nhật giữ nguyên tài khoản, học liệu, bài làm, rank/lộ trình, lịch ôn, ghi âm và audio đã tạo. Không cần reset hoặc tạo lại ngân hàng đề.

Sổ từ, flashcard và thẻ chọn từ sau nộp hỗ trợ **phiên âm IPA**, **Nghe** và **Nghe chậm**. Từ chưa có IPA có nút tra riêng; giọng dùng trình duyệt, không gọi API tạo audio trả phí. Chi tiết nguồn phiên âm và các giới hạn thiết bị ở [word-pronunciation.md](word-pronunciation.md).
