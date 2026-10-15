# Cập nhật riêng app IELTS

`deploy/update-app.py COMMIT ARCHIVE_SHA256` dành riêng cho bản cài
`/opt/websiteIeltsAi-20261007T172235Z-7D7gnc`, Compose project
`website-ielts-ai-20261007172235-7d7gnc`, tên miền `https://sutonghanyu.vn`.
Chạy bằng root trong SSH trên VPS, sau khi tải helper từ commit đầy đủ và kiểm
tra SHA256 helper. SHA256 archive là của archive GitHub codeload cùng commit.
Không dùng nhánh `main` hoặc pipe nội dung tải trực tiếp vào shell.

Helper kiểm tra app đang healthy qua `127.0.0.1:19088` và HTTPS của tên miền,
quyền sở hữu container/mạng/tệp, cấu hình đăng nhập hai tài khoản và cấu hình
Compose hiện tại. Helper dùng khóa cập nhật của bản cài để ngăn hai lượt cập nhật
chạy đồng thời. Mọi thông tin riêng chỉ nằm trong tệp có quyền truy cập riêng.

Bản build có giới hạn 512 MiB RAM, không dùng thêm swap và 0,5 CPU. Mỗi bước
đòi hỏi đủ RAM cho công việc cộng 1024 MiB dự phòng; server bận hoặc thiếu RAM
thì dừng khi app cũ vẫn hoạt động. Archive được kiểm tra hash và từ chối link,
đường dẫn vượt ra ngoài thư mục giải nén hoặc archive quá lớn.

Trước khi thay app, hai image được chạy riêng, không có mạng, để so sánh hash
toàn bộ ngân hàng bài học, đề thi, từ vựng và câu đầu vào. Nếu học liệu khác nhau,
helper từ chối cập nhật. Bản cập nhật chỉ được thay image/build context của app;
cấu hình service khác, origin, tài khoản và cấu hình AI phải giữ nguyên. Không
chạy CLI reset/migration, không thay ngân hàng bài, lịch sử, tiến độ, bản ghi âm,
MongoDB, worker tạo audio hoặc cấu hình Nginx dùng chung.

Khi mọi kiểm tra hoàn tất, helper ghi override mới bằng phép thay tệp nguyên tử
rồi dùng `compose up --no-deps --no-build --wait app`. Chỉ app có thể gián đoạn
ngắn trong bước này. Không có bước kiểm tra RAM hay CLI database chen giữa lúc
dừng và mở app. Nếu app mới không healthy, helper khôi phục override và image
thật của app cũ, miễn cấu hình chưa bị một thao tác khác thay đổi.

Website được xác minh qua tên miền và cổng nội bộ 19088. Helper không reload
proxy HTTPS cũ trên cổng 8088; proxy đó có thể cần cập nhật DNS upstream riêng
nếu còn sử dụng. Không restart Docker hoặc Nginx trên host.

Audit riêng nằm trong `.local/deploy/app-updates/`. Chỉ khi có
`complete.json` với `status: verified` mới xem lượt cập nhật là hoàn tất. Nếu
SSH ngắt hoặc helper chưa báo hoàn tất, kiểm tra trạng thái app và audit trước
khi chạy một lượt khác; không tự chạy lại updater ngân hàng học liệu.

Kiểm tra helper trong cloud:

```bash
node --import tsx --test tests/update-app.test.ts
```

Các tình huống kiểm tra dùng Docker, cấu hình và HTTP giả lập; không tác động
VPS hoặc dữ liệu người học. Lệnh đọc hash ngân hàng cũng đã chạy với image Node
24, filesystem chỉ đọc, RAM 512 MiB và swap 512 MiB trong môi trường cloud.
