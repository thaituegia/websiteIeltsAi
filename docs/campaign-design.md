# Giao diện đồng hành chibi

Toàn bộ không gian học dùng nền kem sáng, chữ tím mận và các mảng màu san hô, xanh bạc hà, tím lilac, vàng bơ. Thẻ bo tròn, bóng nhẹ ở cạnh dưới, nút bấm nổi và minh họa chibi tạo cảm giác một bàn cờ học tập vui tươi. Trang đăng nhập, tổng quan, thư viện, thi thử, lộ trình, từ vựng, lịch sử, sổ lỗi và cài đặt dùng chung ngôn ngữ thiết kế. Các vùng đọc, biểu đồ, câu hỏi và nhập câu trả lời giữ chữ đậm rõ trên nền sáng.

Hai quân cá ngựa có màu và phụ kiện riêng: quân san hô đeo khăn ngôi sao và quân bạc hà có nơ lilac. Tên thật từ tài khoản được hiển thị cùng trạng thái; mỗi quân có nhãn truy cập riêng cho trình đọc màn hình. Trên điện thoại, các bảng trạng thái và biểu mẫu xếp dọc; hai quân ở cùng buổi vẫn được đặt cạnh nhau.

## Tiến độ và huy hiệu

Bản đồ Duo lấy trạng thái trực tiếp từ snapshot của server và luôn có hai quân đại diện cho hai người. Mỗi quân đứng tại buổi chưa hoàn thành đầu tiên đang mở của riêng người đó: một người hoàn thành buổi học thì quân của họ chuyển tới buổi tiếp theo, quân của người còn lại giữ vị trí. Các ô bên dưới vẫn thể hiện buổi chưa mở, đã mở, một người hoàn thành hoặc cả hai hoàn thành.

Khi hết các buổi đang mở, quân dừng tại buổi trước Duo Gate và ghi rõ đang chờ cổng. Một người đạt Gate vẫn chờ người còn lại đạt; vị trí và ô khóa không tự vượt cổng. Hết các buổi và Gate thì hiển thị trạng thái thi nâng band; chặng đã đạt và chặng chưa mở có nhãn riêng. Vị trí mô tả tiến độ đã lưu và bước học tiếp theo, không báo ai đang online hoặc đang mở bài.

Chọn một ô bàn cờ đưa tới và focus thẻ buổi học tương ứng, kể cả ô chưa mở; thao tác này không mở khóa hoặc tự ghi nhận hoàn thành. Xúc xắc và ngôi sao là trang trí, không quyết định tiến độ học.

Các huy hiệu là dấu mốc hiển thị từ dữ liệu đã có, không tạo hệ thống tiền thưởng mới:

- **Bước đầu đồng hành:** cả hai hoàn thành ít nhất một buổi.
- **Vượt cổng kiến thức:** cả hai đạt ít nhất một Duo Gate.
- **Chinh phục chặng mới:** hoàn thành ít nhất một band chung.
- **Đỉnh band 8.0:** hoàn thành band mục tiêu chung.

Học riêng vẫn được phép trong thư viện và thi thử. Chỉ kỳ thi nâng band yêu cầu cả hai cùng vào phòng và sẵn sàng. Giao diện không thay đổi các quy tắc này hay dữ liệu học liệu, đáp án, tiến độ, tài khoản hoặc bản ghi âm.

## Font và tài nguyên

Be Vietnam Pro được phục vụ từ `/fonts/`, gồm Latin, Latin mở rộng và tiếng Việt cho các trọng lượng 400, 500, 600, 700, 800; có italic 400 cho nội dung cần chữ nghiêng. Các tiêu đề bỏ khoảng cách chữ âm, dùng chiều cao dòng đủ rộng cho dấu tiếng Việt. Font không cần kết nối Google Fonts khi sử dụng website.

Font lấy từ gói `@fontsource/be-vietnam-pro@5.3.0`; giấy phép SIL Open Font License nằm ở `public/fonts/OFL-BeVietnamPro.txt`. Minh họa chibi được tạo riêng cho dự án và lưu tại `public/assets/chibi-world.webp`; hai quân cá ngựa và các biểu tượng SVG nằm trong frontend.

Các kiểm tra trình duyệt dùng tài khoản tổng hợp và MongoDB test riêng để kiểm tra font, tài nguyên, bố cục desktop/mobile, hai vị trí độc lập, chờ Gate và mở huy hiệu theo kết quả thật. Kiểm tra vị trí ghi nhận bài làm khách quan và buổi học thật trong database test, đồng thời xác minh chọn ô không thay đổi tiến độ. Ảnh xem trước trong `.local/chibi-preview/` chỉ chứa tài khoản tổng hợp.

Ảnh đã kiểm tra: [tổng quan máy tính](screenshots/chibi-desktop-dashboard.png), [hai người ở hai buổi khác nhau](screenshots/chibi-desktop-board.png), [cùng chờ Gate trên điện thoại](screenshots/chibi-mobile-board.png). Nhãn ngắn trên quân dùng tên cuối; bảng trạng thái và nhãn truy cập vẫn giữ tên đầy đủ.
