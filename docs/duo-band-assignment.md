# Gán hai tài khoản về band 3.0

Theo yêu cầu riêng của chủ website, `deploy/set-duo-band-3.py` và `deploy/set-duo-band-3.mjs` gán hai tài khoản hiện có về band 3.0, mở lộ trình chung từ band 3 tới 8, và bỏ qua bài đầu vào chưa kết thúc của người vợ. Đây là thao tác quản trị một lần; không có endpoint công khai hay tài khoản mới.

Wrapper chạy bằng root trên đúng bản cài `/opt/websiteIeltsAi-20261007T172235Z-7D7gnc`. Dùng commit và SHA256 đã kiểm tra để tải helper từ GitHub. Không cần build lại: helper chạy trong image app hiện tại, dùng bộ tạo học liệu của chính phiên bản đang chạy. Nó kiểm tra hai danh tính với cấu hình hash riêng; từ chối nếu sai database, tài khoản, container, mạng, cổng hoặc đang có đánh giá Duo/chấm AI chưa xong.

Trước khi ghi, chỉ app IELTS tạm dừng; toàn bộ collection và index được sao lưu EJSON vào thư mục riêng 0700, file 0600. Runner giới hạn 256 MiB RAM, không thêm swap, 0,25 CPU, root filesystem chỉ đọc, không capabilities. Luôn giữ 1 GiB RAM dự phòng; không dừng MongoDB/proxy/Nginx hoặc project khác.

Thao tác đổi `users.currentBand`, `personalEstimatedBand` thành 3 và `cefr` thành A2, đồng thời đặt band hiện hành/khởi điểm chung thành 3. Lộ trình chưa có sẽ được tạo bằng đúng cấu hình và học liệu server hiện tại, không thêm bài học vào ngân hàng. Lộ trình đã có giữ các buổi hoàn thành, Gate và các band khác; chỉ mở lại trạng thái nâng band 3 nếu cần, để kết quả nâng band cũ không tự nâng rank ngay sau khi gán.

Bài đầu vào đang mở của người vợ được đóng với `currentQuestionId: null`, xóa draft, giữ các câu đã trả lời và ghi `administrativelySkippedAt`. Kết quả vẫn `null`; không chèn bản ghi kết quả đầu vào giả. Chỉ guard gắn với bài vừa bỏ qua được đóng. Lịch sử đầu vào đã chấm, bài làm, bản ghi âm, mật khẩu và phiên đăng nhập được giữ nguyên.

Helper dùng CAS trên tài liệu gốc và xác minh toàn bộ dữ liệu/index ngoài phạm vi thay đổi. Nếu thất bại trước bước ghi, wrapper khởi động lại app cũ. Nếu đã bắt đầu ghi mà chưa xác minh xong, giữ backup và app tạm dừng để xử lý; không tự khôi phục hoặc xóa dữ liệu. Thành công mới khởi động lại đúng container app, kiểm tra HTTPS, dữ liệu sau khởi động, và đối chiếu các container/cổng/Nginx khác.

Chạy lại khi đã đúng trạng thái sẽ không đổi dữ liệu. Hoàn tất thì tải lại website; người vợ có thể vào lộ trình ngay, vẫn được tự chọn làm một bài đầu vào mới sau này. Kiểm tra dùng tài khoản và MongoDB tạm; không đăng nhập hoặc chấm bài thật của người dùng.
