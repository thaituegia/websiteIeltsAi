# Đề riêng cho Duo Gate và kỳ thi nâng band

Duo Gate không lấy bài từ các buổi luyện vừa học. Kỳ thi nâng band không lấy
full mock trong kho công khai. Ngân hàng mới nằm trong collection
`duo_exam_content`, tách khỏi `content`, `contentBank`, placement và planner.
Ngân hàng công khai hiện có không bị reset hoặc thay thế.

Ngân hàng riêng có 484 bài thuộc 11 mức band 3.0–8.0: 132 Reading, 132
Listening, 88 Grammar, 88 Writing (Academic/General riêng) và 44 Speaking.
Gate có tám biến thể cho mỗi kỹ năng khách quan/band; nâng band có bốn biến
thể cho mỗi kỹ năng/band/profile. Reading/Listening full mock có 40 câu;
Listening có bốn phần hội thoại/bài nói. Những ngữ cảnh mới được biên soạn
theo chủ đề IELTS; dữ kiện, lời thoại và câu hỏi không lấy lại từ kho luyện.
Đây là học liệu biên soạn chưa được giám khảo chính thức hiệu chuẩn.
Writing có bài mẫu Task 1/Task 2 theo đúng dữ kiện đề và hướng dẫn tiếng Việt,
chỉ mở sau khi nộp bài, giống luồng Writing trong kho luyện tập.

Mỗi lượt mới chọn đúng band, loại đề và profile, loại trừ những đề đã dùng
trong lịch sử Duo, gồm cả lượt trượt, hết giờ hoặc bị hủy. Phòng nâng band
dùng chung một bộ đề cho hai người tham gia. Khi hết nguồn đề riêng chưa dùng,
hệ thống từ chối mở và yêu cầu bổ sung học liệu; không lấy lại bài luyện hoặc
đề cũ làm phương án dự phòng. Số lượt là hữu hạn; cấu hình nhiều buổi/Gate hơn
ngân hàng có thể cung cấp cần bổ sung đề trước khi sử dụng.

Lộ trình đã tồn tại chỉ đổi phân bổ tương lai khi bắt đầu một lượt mới, qua
CAS của path. Kết quả đã đạt, buổi đã hoàn thành, bài làm, bản ghi và lượt cũ
đang hoạt động vẫn được giữ để tiếp tục/xem lại. Ngân hàng riêng khởi tạo
bằng insert-only; kiểm tra hash thân bài thực tế và metadata trước khi dùng,
không ghi đè nội dung lịch sử khi phát hiện khác biệt.

ID riêng bị chặn ở GET nội dung, tiến độ, kiểm tra audio và tạo audio thông
thường. Chỉ lượt thi thuộc người học và assessment đã giao mới được mở.
Đáp án vẫn bị ẩn trước khi nộp; xem lại, nghe audio và lưu/dịch từ dùng ngữ
cảnh của đúng lượt thuộc người học. Biết trước một ID không cho phép đọc đề.

Ngân hàng riêng có 264 nguồn audio. Manifest `bank:duo`
tách khỏi manifest `bank` của audio cũ; bộ nhớ đệm audio dùng chung tiếp tục
bỏ qua file đã có. `--inspect --duo-only` chỉ đọc và không khởi tạo ngân hàng.
Đồng hồ thi chỉ bắt đầu sau khi audio của bộ đề được chọn đã sẵn sàng.

Deploy riêng app dùng `--cached-audio-only`, không tạo thêm audio. Cờ tạo toàn
bộ kho `--prepare-duo-exams` đã bị gỡ để tránh phát sinh chi phí ngoài ý muốn.
Các file và turn đã tạo được giữ nguyên, kể cả khi lần chuẩn bị cũ bị ngắt.
Đề còn thiếu audio không bắt đầu tính giờ và không tự gọi TTS.

Pregeneration mặc định có ngân sách 0 request/0 ký tự. Nếu chủ website muốn
tạo thêm trong tương lai, CLI yêu cầu khai báo đồng thời trần request provider
và ký tự JSON gửi lên; retry/lỗi vẫn trừ trần, cache không trừ. Watch dùng cùng
một ngân sách suốt tiến trình và dừng khi hết, không tự cấp ngân sách mới ở
lượt quét sau. Đây là giới hạn kỹ thuật theo lần chạy, không phải trần USD.
Không thay fingerprint/giọng/model của cache để giữ khả năng tái sử dụng.

# Chấm đáp án ngắn

Reading/Listening nhận thêm biến thể ở câu short-answer độc lập. Ví dụ câu
hỏi loại đồ vật có đáp án `yoghurt pots` nhận `Yoghurt pot`; `tray` nhận `A
tray` khi cụm có mạo từ đó nằm trong nguồn và không vượt giới hạn từ. Mạo từ
thêm sai, thay đổi số lượng, tên riêng, tính từ hoặc đáp án điền làm sai ngữ
pháp không tự được chấp nhận. Không dùng fuzzy spelling hay tự đoán từ đồng
nghĩa. `acceptedAnswers` và các dạng giờ viết bằng chữ tiếp tục được áp dụng.

Quy tắc mới dùng khi nộp/chấm lượt tiếp theo. Không tự chấm lại điểm lịch sử
hoặc thay kết quả Gate/rank đã lưu khi mở màn hình xem lại.
