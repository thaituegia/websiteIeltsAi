# Cập nhật bằng audio đã có

Lệnh `deploy/update-app.py COMMIT ARCHIVE_SHA256 --cached-audio-only` chỉ thay
app sau các kiểm tra cũ, giữ cấu hình AI và tất cả cache hiện có. Không chạy
pregeneration hoặc probe model. Cờ `--prepare-duo-exams` đã bị loại bỏ và bị
từ chối trước khi build; cached-only không được kết hợp với nâng model.

Kết quả VPS người vận hành gửi ngày 06/11/2026: không còn worker IELTS;
manifest công khai complete 432/432; manifest riêng pending 171/264, failed 0,
lastErrorCode interrupted. Như vậy còn 93 nguồn riêng chưa tạo, không thể
khẳng định mọi đề đã đủ audio. Dòng log kiểm tra mỗi 15 giây là theo dõi
RAM/container, không phải mỗi dòng một request AI. Một audio có nhiều lượt
thoại và nhiều request; giới hạn số clip hoặc số giờ không phải giới hạn tiền.

`deploy/inspect-exam-audio.py` kiểm tra từng bài Listening, từng phần và các
câu đầu vào qua published cache metadata. Nó dùng image app hiện tại trong
container riêng 384 MiB/no extra swap/0,25 CPU; kiểm tra đúng project/mạng,
giữ 1 GiB RAM dự phòng, chặn `fetch` và không seed/repair/download WAV. Báo
cáo phân nhóm công khai/riêng theo band và lesson/full-mock, kèm số bài đủ
toàn bộ phần, số phần thiếu và ID/tên đề thiếu đã giới hạn độ dài. Toàn bộ
135 đề Listening riêng/267 phần phải có trong inventory sau bản bổ sung ngày
10/11/2026; inventory trống
không được coi là đã đủ. Đây là kiểm tra metadata giống guard trước đồng hồ
thi, không nghe lại hoặc tải toàn bộ nhiều GB âm thanh để kiểm tra thủ công.

# Ngân sách tạo audio trong tương lai

Pregeneration mặc định có ngân sách **0 request và 0 ký tự**. Khi người vận
hành chủ động cấp giới hạn, phải khai báo cả hai trần; không có lệnh tạo
audio trả phí tự động trong quy trình cập nhật cached-only. Bộ đếm dùng chung
cho cả lượt thoại, clip, retry và mọi lượt watch trong một tiến trình. Watch
kết thúc khi hết ngân sách, không tự cấp lại mỗi vòng. Retry/lỗi/abort không
hoàn trả lượt đã gửi; cache clip/turn không trừ ngân sách. Kiểm tra trần là
đồng bộ ngay trước fetch nên hai turn đồng thời không vượt trần.

Ký tự là độ dài JSON gửi đi gồm lời thoại/instructions, không phải token
thanh toán hoặc USD. Giới hạn áp dụng theo một lần chạy, không phải hạn mức
suốt đời của tài khoản. Số tiền đã chi phải đối chiếu Usage/billing của nhà
cung cấp; không suy từ thời gian chạy hoặc số clip hoàn tất.

Không đổi model TTS, voice assignment, AUDIO_VERSION hoặc fingerprint. Giữ
nguyên các clip và turn đã hoàn tất. Các đề thiếu audio vẫn chờ chuẩn bị,
không tự gọi provider khi người học mở bài hoặc bấm nghe.

Ngoại lệ hữu hạn được chủ website yêu cầu ngày 10/11/2026 là ba bộ Gate mới.
`--add-three-gate-papers` chỉ nhắm ba ID Listening của bản bổ sung; có tối đa
ba request/9.000 ký tự JSON cho cả phiên bản và deadline 180 giây. Ledger
lưu bền reservation trước khi gọi provider, kể cả thất bại/abort; chạy lại
không cấp thêm lượt. Chế độ này không tiếp tục 93 nguồn cũ đang thiếu, không
chạy watch hoặc thử lại request lỗi, và không được ghép với cờ nâng model.
Chỉ cập nhật app sau khi xác minh ba audio mới sẵn sàng. Đây vẫn không phải
trần USD: giá thực tế phụ thuộc nhà cung cấp hiện tại.
