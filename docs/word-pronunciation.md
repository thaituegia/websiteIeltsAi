# Phiên âm và nghe từ mới

Kho từ, **Từ đã lưu**, flashcard và màn hình chi tiết từ hiển thị phiên âm IPA cùng các nút **Nghe**, **Nghe chậm**. Ở thẻ đầy đủ có lựa chọn ưu tiên giọng Anh–Anh hoặc Anh–Mỹ; nếu thiết bị chỉ có một giọng tiếng Anh khác, giao diện thông báo giọng thực tế. IPA có font riêng hỗ trợ ký hiệu ngữ âm.

Trong bài học/thi, thẻ chọn từ vẫn chỉ lưu từ trước khi nộp. Khi xem lại bài đã hoàn thành hợp lệ, thẻ mở thêm IPA và nghe phát âm bên cạnh nghĩa theo ngữ cảnh. IPA không phải bản chấm phát âm của người học.

Từ lưu từ ngân hàng giữ luôn IPA. Thẻ cũ hoặc từ tự lưu chưa có phiên âm có nút **Xem phiên âm**: máy chủ tìm đúng từ trong ngân hàng trước, rồi tra `phonetics[].text` của Free Dictionary API tại `api.dictionaryapi.dev` nếu cần. Chỉ gửi từ được tra; không gửi câu gốc, bài làm, tài khoản hoặc khóa OpenAI. Kết quả phải khớp đúng cách viết, không tự lấy phiên âm của một từ gốc khác. Cụm từ ngoài ngân hàng hoặc từ chưa có phiên âm được báo rõ; không đoán IPA.

Tra cứu thành công chỉ bổ sung `ipa` và `ipaSource` vào thẻ riêng hiện có. Nghĩa chờ sau nộp, lịch FSRS, review log và bài làm giữ nguyên. API có kiểm tra chủ sở hữu; route trong bài kiểm tra lại trạng thái hoàn thành sau khi chờ tra cứu. Có cache giới hạn, gộp yêu cầu đồng thời và timeout; khi dịch vụ ngoài lỗi, từ đã lưu vẫn còn và có nút thử lại.

Nút nghe dùng Web Speech của trình duyệt để đọc từ gốc, không đọc chuỗi IPA và không gọi OpenAI/ElevenLabs để tạo audio. Không phát sinh phí API tạo giọng từ tính năng này. Tốc độ thường là 1, chậm là 0,7; chất giọng phụ thuộc các giọng tiếng Anh trên thiết bị. Nếu trình duyệt không hỗ trợ hoặc chưa có giọng tiếng Anh, IPA vẫn đọc được và giao diện hướng dẫn thử lại/cài giọng. Nút nghe từ không ngắt một bài Listening đang sở hữu hàng đợi Web Speech.

Không cần seed, migration, reset ngân hàng hay tạo lại audio Listening. Cập nhật bằng helper app-only hiện có. Máy chủ cần HTTPS ra `api.dictionaryapi.dev` cho các từ ngoài ngân hàng; 648 IPA có sẵn và giọng trình duyệt không phụ thuộc dịch vụ tra cứu này. Cấu hình mạng cloud là riêng với VPS; lưu draft cloud không tự triển khai website.

API (đều yêu cầu đăng nhập, response `private, no-store`):

| Route POST | Body | Kết quả |
| --- | --- | --- |
| `/api/vocabulary/cards/:id/pronunciation` | Không cần | IPA cho đúng thẻ của người đăng nhập; có thể bổ sung IPA cho thẻ đang chờ nghĩa mà không mở nghĩa. |
| `/api/attempts/:id/words/pronunciation` | `{word, context?, sectionIndex?}` | Chỉ bài thuộc người dùng, đã nộp hợp lệ; từ phải có trong nội dung nguồn được phép xem. |
| `/api/placement/:id/words/pronunciation` | `{word, context?, questionId?}` | Chỉ bài đầu vào hoàn thành hợp lệ và câu đã được phục vụ cho người dùng. |

Response thành công: `{pronunciation:{word,ipa,source:'bank'|'dictionary'}}`. Không trả nghĩa, định nghĩa, URL audio hoặc payload thô của từ điển. Không tìm được IPA trả 404; gián đoạn từ điển trả 503 với thông báo thử lại.
