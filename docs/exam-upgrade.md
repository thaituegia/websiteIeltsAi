# Ngân hàng gấp ba và xem đáp án

Bản `fresh-20261011-v3` giữ nguyên toàn bộ bộ v2 và thêm đúng hai lần số lượng từng kỹ năng/dạng bài: 540 bài luyện, 104 đề mô phỏng, 432 mục từ và 320 câu đầu vào. Tổng mới là **810 bài luyện, 156 đề, 648 mục từ và 480 câu đầu vào**. Mọi tài khoản, bài làm, session, flashcards, hành trình và audio hiện có được giữ nguyên.

Reading có 3 sections/40 câu/60 phút; Listening có 4 Parts/40 câu/30 phút với vai trò xã hội/học thuật đúng mỗi Part; Writing có hai Tasks/60 phút; Speaking có ba Parts/11–14 phút. Nguồn đề mới độc lập với bài luyện, có biểu đồ, sơ đồ và bản đồ. Band vẫn là ước lượng, học liệu AI chưa được giám khảo hiệu chuẩn.

## Xem kết quả

Sau khi hoàn thành placement, bài luyện hoặc đề thi, trang kết quả hiển thị tất cả câu khách quan, bao gồm câu bỏ trống: đề bài/ngữ cảnh, lựa chọn, câu trả lời của người học, đáp án đúng, biến thể được chấp nhận, giải thích và dẫn chứng. Có bộ lọc tất cả/sai/chưa trả lời. Đáp án nhóm chọn nhiều được trình bày thành các lựa chọn dễ đọc.

Placement lưu đúng câu hỏi đã được chọn thích ứng và snapshot đáp án khi trả lời; kết quả mở sau khi hoàn thành hoặc hết thời gian. Quick 15 câu/20 phút, Deep 30 câu/40 phút; deadline được lưu server và không đặt lại khi reload. Câu đang xem được lưu với lựa chọn nháp hoặc đáp án bỏ trống; không tạo câu đã làm cho các câu chưa từng được phục vụ. Ít hơn 5 câu trả lời thì band null, không cập nhật hồ sơ/lộ trình. Có thể mở lại placement từ lịch sử. Bắt đầu bài đầu vào mới không hiển thị đáp án của lượt cũ trong bài đang làm.

Writing/Speaking hiển thị bài mẫu tham khảo cho từng Task/Part sau nộp: bài viết hoàn chỉnh theo dữ liệu đề, bài nói Part 2 và câu trả lời riêng cho mọi câu Part 1/3. Đây là ví dụ minh họa, không phải đáp án duy nhất hoặc cam kết band. Kho mẫu có 774 Writing Tasks/Speaking Parts, gồm 1.656 câu trả lời phỏng vấn. Xem mẫu không cần API key; điểm AI vẫn cần provider hợp lệ. Khi chưa có provider, bài được lưu với band `null`.

Reference chỉ tồn tại trong `StoredContent`, không nằm trong `ContentItem` public. List/detail/generate và các lượt đang làm không trả keys/models; chỉ feedback của lượt đã nộp hoặc placement đã hoàn thành được công bố. Các lượt thuộc người khác vẫn bị từ chối. Hệ thống không bịa đáp án cho câu cũ đã mất nguồn.

## Cập nhật giữ dữ liệu

Seed thường chỉ thêm ID mới và mẫu còn thiếu. Mẫu chỉ được gắn nếu nguồn/câu hỏi/đáp án hiện có khớp chính xác nguồn mà mẫu giải thích; bài đã sửa hoặc mẫu giáo viên đã có được giữ nguyên. Tài khoản, điểm, session, flashcards, placement, lịch học, hành trình Duo, phòng thi, audio/GridFS và nội dung tự tạo không bị xóa.

Đối với triển khai đã dùng fresh v2, công cụ quản trị sao lưu mọi collection/index bằng canonical EJSON, kiểm hash trước thay đổi và xác minh từng bản ghi cũ sau bổ sung:

```sh
npm run bank:upgrade:inspect
# Chỉ khi app IELTS đã dừng; dùng thư mục backup mới, tuyệt đối:
IELTS_APP_OFFLINE=true npx tsx server/bank-upgrade-cli.ts apply /absolute/new/private-backup
npx tsx server/bank-upgrade-cli.ts verify /absolute/new/private-backup
```

Công cụ apply chỉ thao tác database `ielts_ai`. Không drop database, xóa dữ liệu hoặc cấp lại tài khoản. Backup/log là private, quyền thư mục 0700/file 0600. Sau lỗi apply cần giữ app offline để đọc receipt trước xử lý; không tự rollback hoặc chạy seed lịch sử.

## VPS hiện tại

Entrypoint được ghim commit/checksums phân biệt ngân hàng đang chạy:

```sh
bash deploy/run-exam-update.sh LIVE_DIR SOURCE_COMMIT ARCHIVE_SHA256 RESET_SCRIPT_SHA256 UPDATE_SCRIPT_SHA256
```

Entrypoint chỉ chấp nhận fresh v2 đầy đủ hoặc v3 đầy đủ, luôn chọn `deploy/update-exams.sh`. Legacy, fresh v1, phiên bản không rõ hoặc dữ liệu thiếu bị từ chối trước khi tải updater; không còn đường chạy reset. Tham số checksum reset được giữ để tương thích giao diện lệnh cũ nhưng không được dùng để chạy reset.

Wrapper dùng `deploy/Dockerfile.release`, build giới hạn **512 MiB/0.5 CPU**, không dùng thêm swap khi app cũ vẫn chạy. Hai chương trình TypeScript chạy tuần tự với cùng compiler options nghiêm ngặt như cấu hình chính, bao phủ toàn bộ source production; sau đó Vite bundle và prune dependencies. `npm run build` và Dockerfile mặc định vẫn kiểm cả source/test như trước. Cài dependencies vẫn là frozen `npm ci` từ lockfile.

Sau giải nén với `umask 077`, wrapper đặt riêng các thư mục con chứa source công khai thành 0755 và file source thành 0644. Thư mục gốc của release/source, credentials, audit và backup vẫn private 0700/0600. Điều này cho phép CLI root đã bỏ mọi capability đọc source sau khi Docker `COPY` chuyển chủ sở hữu sang `node`; không cần cấp thêm capability hoặc thay compiler options. Archive vẫn được kiểm toàn bộ trước khi ghi, từ chối symlink/hardlink, đường dẫn thoát thư mục và file đặc biệt.

Giữ **1024 MiB RAM dự phòng**, nên bước build/manifest/CLI cần ít nhất **1536 MiB MemAvailable**. Kiểm lại ngay trước từng bước, trước dừng app và trước thay đổi database. Sau dừng riêng app IELTS, ngưỡng dùng `max(512 MiB, giới hạn app thực tế) + 1024 MiB`; không giả định toàn bộ giới hạn RAM của app vừa được giải phóng. Khởi động app mới cũng kiểm theo giới hạn hiện có, không thay cấu hình tài nguyên runtime. Lỗi trước mutation marker khôi phục riêng app cũ; sau marker giữ app offline cùng backup để xử lý. Không giải phóng cache hệ thống, tắt dịch vụ khác hoặc chỉnh swap.

MongoDB, proxy, host Nginx, TLS, cổng và project khác được đối chiếu giữ nguyên. Cấu hình credentials lấy riêng từ đúng app được kiểm chứng, không xuất ra terminal hoặc command history. Sau verify database, kiểm HTTPS, origin và assets trước báo hoàn tất. Kết quả cloud/Git không chứng minh VPS đã cập nhật; cần output/receipt thực tế.

## AI riêng của bản cài

Cấu hình key/model được đóng gói dạng ciphertext AES-256-GCM, không chứa key plaintext. Khóa mở được dẫn xuất HKDF từ hai hash scrypt riêng của bản cài và salt ngẫu nhiên; AAD ràng buộc phiên bản và HTTPS origin. Updater mở thử cấu hình trong container offline chỉ đọc, trước khi dừng app hoặc ghi database. Nếu không khớp, app cũ tiếp tục chạy và cập nhật dừng.

Runtime mở key trong bộ nhớ backend sau khi xác minh credentials; env key riêng luôn được ưu tiên để thay key. Khi đổi hash credentials cần cấu hình key env mới. Health chỉ cho biết cấu hình, không phải provider probe. Bộ chấm Writing dùng dữ liệu hình thật; Speaking dùng Whisper và `gpt-audio` nghe WAV, kiểm timestamp và dẫn chứng trước tính trung bình bốn tiêu chí. Transcript-only không được suy ra phát âm. Các lỗi quota/provider/schema giữ bài/bản ghi để chấm lại.
