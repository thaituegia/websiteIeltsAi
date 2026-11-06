# Duo Gate chung đề và tránh kết thúc nhầm

Log VPS ngày 06/11/2026 ghi nhận assessment answering bị hủy do
`heartbeat-lost` lúc 21:18:24 và `page-exit` lúc 21:19:31 (Asia/Bangkok).
Hai ảnh kết quả có điểm không tự chứng minh sự kiện hủy nào đã xảy ra;
không dùng ảnh để suy đoán người học đã chủ động chuyển tab.

Heartbeat của phiên và phòng có timeout 8 giây, ngắn hơn lease 25 giây. Một
fetch bị treo được giải phóng để nhịp kế tiếp có thể thử lại khi mạng phục
hồi. Thời gian từ lần xác nhận cuối dùng `performance.now()`, không dùng
đồng hồ thiết bị có thể nhảy. Mất kết nối liên tục quá lease vẫn kết thúc
theo quy định; không nới việc đổi tab, đóng trang hoặc mở tài khoản ở trang
khác.

`beforeunload` chỉ báo ý định rời và có thể bị hủy. Nó không còn tự phát
violation. Việc rời thật vẫn được nhận qua `pagehide`, document hidden,
điều hướng SPA và lease server của document mới. Thông báo kết thúc dùng mã
nguyên nhân cụ thể; mất kết nối không được gắn chung như hành vi đổi tab.

Attempt API có `serverNow` response-only. Đồng hồ bài làm lấy mốc server và
thời gian monotonic; response cũ không làm lùi mốc, đổi attempt tạo mốc riêng.
Nếu một client gửi automatic `timedOut:true` trước deadline của server,
server trả lượt còn hoạt động và `deadlinePending:true`, không ghi/chấm bài
nháp. Client đồng bộ lại và tiếp tục chỉnh sửa. Khi server thực sự hết giờ,
chỉ dữ liệu đã lưu được chấm; nộp tay tiếp tục như trước. Clock fix này ngăn
một loại tự nộp sớm, không khẳng định đó là nguyên nhân của log rời trang.

Duo Gate dùng bộ đề chung theo đợt, lưu bằng path CAS và reservation ngắn
hạn. Concurrent start/click trùng không tạo hai bộ hoặc làm mất phiếu đang
mở. Ticket hết hạn/lỗi cache sẵn sàng được dọn và thử lại. Lượt cũ đang hoạt
động, kể cả hai người đã nhận đề khác nhau trước bản sửa, được giữ nguyên;
lượt chung mới không âm thầm lấy lại một bộ đã lộ từ lịch sử cũ.

Không thay ngân hàng đề, cache audio, model, key hoặc ngân sách TTS. Triển
khai dùng `--cached-audio-only`, không gọi AI, không tạo voice mới và không
reset tài khoản/lộ trình. Chưa sửa dữ liệu hoặc xác nhận vận hành trên VPS
trước khi người vận hành chạy bản cập nhật.
