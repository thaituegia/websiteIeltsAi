> Bản hiện hành dùng **deploy/run-exam-update.sh**: cập nhật từ fresh v2 lên v3 và giữ dữ liệu; từ chối legacy/v1, không có đường chạy reset. Xem [exam-upgrade.md](../docs/exam-upgrade.md) và [bank-reset.md](../docs/bank-reset.md). Các updater v3 bên dưới là lịch sử.

# Triển khai VPS, tách riêng các project đang chạy

Bộ triển khai này chưa chứng minh server đích đã kết nối được hoặc website đã public. Chỉ triển khai khi SSH, tài nguyên máy và cổng public đã kiểm tra thực tế. Không đổi cấu hình nginx/PM2 của server, không nâng cấp hệ thống, không cài lại Docker, không khởi động lại dịch vụ của project khác.

Yêu cầu: Docker đang hoạt động, Docker Compose v2, Bash, OpenSSL nếu tự tạo chứng chỉ. MongoDB 8 trên x86-64 cần CPU có AVX; ARM64 phải đáp ứng yêu cầu nền tảng ARM của MongoDB (không dùng AVX). Cần dung lượng trống và RAM đủ cho build cùng các project hiện tại. Giới hạn mặc định của ứng dụng là 768 MB, MongoDB 768 MB, proxy 128 MB; build cũng dùng tài nguyên máy. Đọc baseline trước khi build, điều chỉnh giới hạn trong `.local/deploy/deploy.env` khi cần.

## 1. Đưa đúng mã nguồn lên thư mục mới

Tạo archive từ commit đã kiểm tra, chỉ chứa file Git; không upload mật khẩu SSH, `.env`, `node_modules`, `.local` hoặc dữ liệu MongoDB của môi trường phát triển. Ví dụ ở máy có checkout:

```bash
git archive --format=tar.gz --output=/tmp/website-ielts-ai-source.tar.gz HEAD
scp -P YOUR_SSH_PORT /tmp/website-ielts-ai-source.tar.gz root@YOUR_IP:/tmp/
```

Trên server, dùng thư mục riêng mới như `/opt/websiteIeltsAi`. Nếu thư mục đã có, dừng để kiểm tra quyền sở hữu và nội dung; không xóa hoặc chép đè project chưa xác định. Giải nén archive tại đây. Ghi lại commit nguồn và SHA256 của archive trong hồ sơ triển khai.

## 2. Kiểm tra server và cổng trước khi build

Có thể chọn cổng đầu tiên còn trống trong khoảng 8088–8188 bằng lệnh chỉ đọc `bash deploy/select-port.sh`; kết quả chỉ là một số cổng, không giữ chỗ cho cổng này. Ví dụ bên dưới giả sử 8443 **đã được xác nhận trống**, dùng tên Compose riêng:

```bash
cd /opt/websiteIeltsAi
bash deploy/preflight.sh 8443 website-ielts-ai-prod
```

Preflight chỉ đọc các cổng đang nghe, cổng Docker đã publish, tên container, CPU/RAM/disk và AVX. Nó từ chối nếu cổng bị chiếm hoặc tên project đã có container, volume hay network; không đọc biến môi trường container. Ghi baseline vào file có quyền 0600 ở ngoài Git nếu cần so sánh sau triển khai. Không mở firewall hoặc security group khi chưa kiểm tra chính sách hiện tại. Nếu Docker chưa có hoặc host không đủ tài nguyên, dừng thay vì sửa toàn bộ server.

## 3. Tạo cấu hình riêng và TLS

Ứng dụng production cần HTTPS: cookie đăng nhập dùng `Secure`, và ghi âm trình duyệt cần secure context. Nếu có chứng chỉ hợp lệ cho IP/domain đã sở hữu:

```bash
bash deploy/init.sh YOUR_IP_OR_DOMAIN 8443 website-ielts-ai-prod
```

Chép certificate chain vào `.local/deploy/tls/site.crt` và khóa riêng vào `.local/deploy/tls/site.key`, đặt khóa riêng quyền 0600. Nếu chưa có domain/chứng chỉ, có thể tạo chứng chỉ tự ký cho đúng IP:

```bash
bash deploy/init.sh YOUR_IP 8443 website-ielts-ai-prod --self-signed
```

Trình duyệt sẽ hiện cảnh báo chứng chỉ; cần chấp nhận chứng chỉ này trước khi đăng nhập hoặc ghi âm. Chứng chỉ tự ký không mang trạng thái tin cậy công khai. `init.sh` từ chối ghi đè cấu hình đã có và không khởi chạy container.

Các file runtime được đặt trong `.local/deploy/`, đã nằm ngoài Git và Docker build context nhờ `.gitignore` và `.dockerignore` của project. Chỉ sửa `.local/deploy/app.env` trên server để thêm API key thật nếu muốn chấm AI trực tiếp, giọng đọc ElevenLabs và Azure pronunciation. Để trống thì tính năng offline/checklist vẫn dùng được; không tạo điểm AI giả. Không ghi key vào Compose hoặc tài liệu. Giá trị chứa `$` hoặc `#` nên được đặt trong dấu nháy đơn trong env file.

`APP_ORIGIN` được tạo từ đúng `https://host:port`; URL truy cập phải khớp giá trị này. App chỉ có một instance; giới hạn hai tài khoản thật. Production tắt tài khoản demo, người dùng đăng ký trên giao diện.

## 4. Build rồi khởi động riêng project này

```bash
bash deploy/compose.sh validate
bash deploy/compose.sh build --pull app
# Kiểm tra lại cổng vì build có thể mất thời gian.
bash deploy/preflight.sh 8443 website-ielts-ai-prod
bash deploy/compose.sh up -d --wait
bash deploy/compose.sh ps
```

Chỉ proxy publish `0.0.0.0:8443`; Node và MongoDB không publish cổng host. MongoDB nằm trong network private và lưu vào named volume riêng của Compose project. Không dùng `container_name` toàn cục. App chạy user `node` theo Dockerfile, proxy giữ `Host` có cổng và thông báo HTTPS. SSE không bị buffer; timeout 16 phút và body tối đa 26 MB hỗ trợ ghi âm.

Kiểm tra từ server và từ một máy bên ngoài:

```bash
curl --fail --show-error https://YOUR_IP_OR_DOMAIN:8443/api/health
curl --fail --show-error https://YOUR_IP_OR_DOMAIN:8443/api/auth/me
```

Nếu dùng chứng chỉ tự ký vừa tạo, xác nhận fingerprint và kiểm tra đúng chứng chỉ đó:

```bash
openssl x509 -in .local/deploy/tls/site.crt -noout -fingerprint -sha256
curl --fail --show-error --cacert .local/deploy/tls/site.crt https://YOUR_IP:8443/api/health
```

Khi kiểm tra từ máy bên ngoài, chép riêng `site.crt` đã xác minh fingerprint; không chép khóa `site.key`. Không bỏ qua kiểm tra TLS. Kiểm tra giao diện, đăng ký/đăng nhập, danh sách bài, lưu bài, flashcard, ghi âm/SSE; nếu dùng tài khoản thử thì nó sử dụng một trong hai suất đăng ký. AI thật chỉ kiểm tra khi đã cấu hình key thật. So sánh lại listeners/container baseline để xác nhận project cũ vẫn chạy. Nếu cổng không truy cập từ bên ngoài, kiểm tra firewall/security group trước; không tự sửa rule của project khác.

## Vận hành và dừng riêng website

### Cập nhật ngân hàng nội dung v3 trên website đã có domain

Với triển khai hiện tại tại `https://sutonghanyu.vn`, dùng `deploy/update.sh` thay vì chạy lại bootstrap. Script nhận thư mục live, commit Git đầy đủ và SHA256 của archive tương ứng:

```bash
bash deploy/update.sh LIVE_DIR SOURCE_COMMIT ARCHIVE_SHA256 --check
bash deploy/update.sh LIVE_DIR SOURCE_COMMIT ARCHIVE_SHA256
```

`--check` chỉ kiểm tra hiện trạng. Lượt cập nhật tải đúng commit, kiểm checksum, build khi app cũ vẫn chạy với giới hạn 1024 MiB RAM và 0,5 CPU, rồi chỉ tạo lại service `app`. MongoDB, proxy, host Nginx, chứng chỉ và các project khác được đối chiếu với baseline. Ngân hàng đạt 480 bài luyện, 72 đề mô phỏng, 648 mục từ vựng và 576 câu placement; các ID cũ cùng học liệu tự tạo ngoài seed được giữ lại. Tài khoản, tiến độ, flashcard và ghi âm không nằm trong phạm vi seed.

Script giữ image/source cũ để khôi phục. Khi có lỗi, chỉ tự loại bỏ học liệu mới nếu dữ liệu cũ không đổi, bản ghi mới khớp manifest và chưa có dữ liệu học tập tham chiếu tới chúng. Nếu điều kiện này không đạt, script giữ dữ liệu và bản mới, báo log riêng để xử lý. `release.compose.yaml` lưu image và đường dẫn source riêng cho các lần vận hành tiếp theo. Script này dành cho đúng triển khai đã kiểm tra, không phải trình cài đặt cho VPS bất kỳ.

Với lần cập nhật từ commit `3e6037bf7da2d9ddf5e84b4193353f7a721e9bc9`, `mongosh` có thể báo `EAGAIN` khi đọc manifest gần 8 MB từ Docker stdin. Helper hiện tại đã sửa bằng file tạm riêng quyền 0600 trong đúng container MongoDB, kiểm tra byte count/SHA256 và tự dọn file sau khi truy vấn. Cách này áp dụng cho cả xác minh ID và guarded rollback.

Nếu app mới đang healthy với 480/72/648/576 nhưng lượt cũ dừng tại lỗi đọc manifest, dùng script xác minh riêng thay vì build lại:

```bash
bash deploy/verify-update.sh LIVE_DIR
# Chỉ định AUDIT_DIR nếu có nhiều lượt trong cùng một giây.
bash deploy/verify-update.sh LIVE_DIR AUDIT_DIR
```

Script tự chọn audit gần nhất của commit v3, kiểm tra đúng image/release/origin/loopback, so sánh từng bản ghi seed và toàn bộ bản ghi public cũ bằng canonical EJSON, xác minh HTTPS/assets và đối chiếu container/cổng/cấu hình với baseline. Nó không build, restart, seed hoặc thay đổi bản ghi database; chỉ tạo receipt riêng trong thư mục audit. Nếu dữ liệu hoặc baseline khác, script dừng và giữ nguyên hiện trạng. Receipt đạt xác nhận trạng thái hiện tại, không ghi đè log lỗi của lượt trước.

```bash
bash deploy/compose.sh logs --tail 100 app proxy
bash deploy/compose.sh ps
bash deploy/compose.sh stop
bash deploy/compose.sh start
# Gỡ container/network của đúng project, giữ volume dữ liệu.
bash deploy/compose.sh down
```

Không dùng `docker system prune`, `docker volume prune`, `docker compose down -v` hoặc dừng mọi container. Script chặn `down --volumes`. Trước khi nâng phiên bản, sao lưu volume MongoDB vào vị trí riêng có quyền 0600, ghi lại image/commit trước, chỉ build và recreate service `app` của project này. Việc cập nhật chứng chỉ chỉ cần restart `proxy` của project này. Mọi thao tác backup/restore đều phải dùng tên project và volume đã xác nhận; không xóa dữ liệu để giải quyết lỗi khởi động.
