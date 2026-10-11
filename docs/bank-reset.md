> Chỉ áp dụng reset cho yêu cầu xóa ngân hàng legacy trước đây. Nếu đã dùng bộ fresh, chọn công cụ [cập nhật giữ dữ liệu](exam-upgrade.md); không xóa tiến độ học mới.

# Thay toàn bộ dữ liệu IELTS, giữ hai tài khoản

Ngân hàng `fresh-20261011-v2` có 270 bài luyện, 52 đề mô phỏng, 216 mục từ và 160 câu placement mới. Đây là thao tác quản trị đáp ứng yêu cầu xóa toàn bộ dữ liệu cũ của người dùng, không phải seed thường hay endpoint cho học viên.

Reset giữ đúng hai account đã cấu hình riêng: `_id`/`id`, tên, phone, vai trò Duo, password hash, email và ngày tạo. Target trở về 8.0; band/CEFR/placement/tiến độ, bài làm, flashcard, lịch học, session/cookie, phòng thi, dữ liệu tự sinh và GridFS recording cũ được xóa. Tài khoản legacy ngoài hai người bị xóa. Hai người đăng nhập lại và làm placement mới để tạo hành trình chung.

`server/bank-reset-cli.ts` mặc định chỉ inspect. Apply yêu cầu app đã dừng, database đúng `ielts_ai`, cấu hình private khớp chính xác hai danh tính tồn tại và đường dẫn backup mới tuyệt đối. Nó không tạo account mới và không drop database, volume hoặc index. Mọi collection riêng trong database IELTS được sao lưu dưới dạng canonical EJSON lines giữ kiểu BSON; metadata chứa definition/options/indexes. File quyền 0600, thư mục 0700. Receipt lưu counts/SHA256, phiên bản bộ mới và trạng thái `backed-up` → `replacing` → `complete`.

Trước lần xóa đầu tiên, công cụ đọc lại SHA của backup và so sánh lại toàn bộ database/metadata. Thay đổi dữ liệu, index, collection hoặc tài khoản trong lúc backup sẽ dừng thao tác. App phải tiếp tục offline xuyên suốt backup/reset/verify. Backup được giữ ngoài database và không được phục vụ trên HTTP; nó là bản phục hồi riêng, không phải học liệu đang hoạt động.

## VPS đang chạy nhiều project

Entrypoint tiện dụng đọc hai credentials đã mã hóa từ đúng container app đang chạy; không phải nhập lại phone/password/hash:

```sh
bash deploy/run-bank-reset.sh LIVE_DIR SOURCE_COMMIT ARCHIVE_SHA256 RESET_SCRIPT_SHA256
```

Script kiểm tra quyền root, đường dẫn triển khai, Compose labels, app đang chạy và schema credentials trước khi tải công cụ reset. File tạm riêng 0600 được dọn cả khi thất bại. Lệnh ghim commit và SHA256 của chính entrypoint cũng phải được xác minh trước khi chạy.

Entrypoint truyền cấu hình private vào wrapper bên dưới:

```sh
bash deploy/reset-bank.sh LIVE_DIR SOURCE_COMMIT ARCHIVE_SHA256 < PRIVATE_HASHED_CREDENTIALS_JSON
```

Dùng lệnh tải script đã ghim commit và SHA256 do agent chuẩn bị sau khi kiểm tra. Không dùng `update-duo.sh` của bộ cũ cho thao tác này: updater đó chỉ thêm dữ liệu và cố ý giữ lịch sử.

Wrapper kiểm tra đúng Compose project/container/loopback/domain, quyền root, tài nguyên và TLS. Nó xác minh archive rồi build riêng tối đa 1024 MiB RAM/0.5 CPU khi app cũ vẫn chạy. Chỉ app IELTS dừng; một container CLI có giới hạn tài nguyên kết nối mạng MongoDB riêng để backup/reset. Chỉ sau verify thành công mới khởi động image mới. Container MongoDB/proxy, cấu hình/cổng website khác và host Nginx được đối chiếu giữ nguyên.

Trước reset, lỗi build/preflight không thay dữ liệu; app cũ có thể khôi phục. Từ khi reset bắt đầu, wrapper không tự khôi phục image/seed cũ hoặc rollback dữ liệu. Nếu có lỗi, giữ app offline hoặc bản mới cùng backup/receipt/log riêng để xử lý; không chạy image cũ vì nó có thể nạp lại ngân hàng cũ. Không khôi phục cả MongoDB server vì trên VPS có project khác.

## Cloud development

```sh
npm run bank:inspect
# Chỉ khi chính app development IELTS đã dừng:
IELTS_APP_OFFLINE=true npx tsx server/bank-reset-cli.ts apply /absolute/new/private-backup
npm run bank:verify
```

Reset dùng cấu hình private sẵn có; không ghi phone/password/hash thật vào Git hoặc command line. Test sử dụng namespace MongoDB random riêng và dữ liệu synthetic, không xóa database học viên để kiểm thử.

Build/audit/test cloud đạt không chứng minh đã reset website công khai. Kết quả trên VPS phải có receipt complete, đúng hai account, bộ mới khớp nguồn, dữ liệu học cũ trống trước startup và HTTPS health mang phiên bản mới.
