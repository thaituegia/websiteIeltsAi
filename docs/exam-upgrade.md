# Ngân hàng gấp ba, xem đáp án và lượt kiểm tra

Bản `fresh-20261011-v3` giữ nguyên toàn bộ bộ v2 và thêm đúng hai lần số lượng từng kỹ năng/dạng bài: 540 bài luyện, 104 đề mô phỏng, 432 mục từ và 320 câu đầu vào. Tổng mới là **810 bài luyện, 156 đề, 648 mục từ và 480 câu đầu vào**. Mọi tài khoản, bài làm, session, flashcards, hành trình và audio hiện có được giữ nguyên.

Reading có 3 sections/40 câu/60 phút; Listening có 4 Parts/40 câu/30 phút với vai trò xã hội/học thuật đúng mỗi Part; Writing có hai Tasks/60 phút; Speaking có ba Parts/11–14 phút. Nguồn đề mới độc lập với bài luyện, có biểu đồ, sơ đồ và bản đồ. Band vẫn là ước lượng, học liệu AI chưa được giám khảo hiệu chuẩn.

## Rời trang và làm lại kiểm tra

Quy tắc giữ trang áp dụng cho **placement, mọi lượt `mode: exam`, Duo Gate và thi nâng band**. Bài luyện thông thường `mode: practice` tiếp tục tự lưu và resume sau khi rời trang hoặc reload. Trước kiểm tra, giao diện giải thích quy tắc và yêu cầu xác nhận bắt đầu.

Khi đang trả lời, trang bị ẩn do chuyển tab, điều hướng sang trang khác, reload/đóng trang hoặc một trang website mới đã xác thực bằng cùng tài khoản sẽ hủy lượt hiện tại. Lease trang làm bài là **25 giây**; heartbeat mất quá hạn không cho tiếp tục bản cũ. Trong phòng thi nâng band chung đang thi, một người vi phạm hủy lượt hiện tại của cả hai; Companion cũng phải giữ sự hiện diện. Nếu còn đang chuẩn bị/đếm ngược, rời phòng sẽ bỏ Ready và đưa phòng về chờ để xác nhận lại trước khi bắt đầu. Kết quả đã hoàn thành trước đó, điểm, tiến độ và pass được bảo lưu vẫn giữ nguyên. Gate làm riêng không yêu cầu người kia online.

Lượt mới lấy nguồn/câu hỏi khác từ học liệu hiện có, kiểm tra nội dung thực tế để tránh bản sao chỉ đổi ID. Không gọi AI trả phí để tạo đề và không dùng cách xáo thứ tự làm bộ câu hỏi mới. Đề đầy đủ giữ skill, Academic/GT, số phần, vai trò phần, 40 câu Reading/Listening và thời lượng; Speaking giữ cặp Part 2/3 liên quan. Lessons dùng khối lượng tương đương và ưu tiên các nhóm dạng câu hỏi gần nhau; Grammar có thể đổi sang quy tắc khác ở cùng mức. Key, biến thể, evidence, hình/blank và bài mẫu đều đi theo đúng nguồn mới, với ID/tham chiếu được ánh xạ lại. Nguồn gốc và bài mẫu của giáo viên không bị sửa.

Ưu tiên CEFR gốc rồi band gần nhất, chênh tối đa 1.0. Chỉ khi hết nguồn phù hợp ở CEFR gốc mới xét đề nguyên vẹn ở CEFR liền kề trong cùng giới hạn band; metadata server `difficultyFallback: true` và band/CEFR thật được giữ. Ví dụ đề Listening A2/band 3.5 duy nhất được thay bằng đề B1/band 4.5, hiển thị đúng mức mới. Placement vẫn chọn thích ứng theo Rasch, loại các câu đã dùng/câu đang hiển thị của lượt cũ. Khi ngân hàng không còn học liệu mới phù hợp, yêu cầu làm lại bị từ chối **HTTP 409**; hệ thống không bịa câu hỏi hoặc tái dùng bộ cũ.

Sau khi server chấp nhận lượt nộp cuối cần chấm AI, câu trả lời khóa lại và pha chờ chấm dùng lease **1.200 giây**. Với lượt cá nhân, rời/reload trang trong pha chờ chấm hợp lệ không hủy yêu cầu đang chấm; provider trả kết quả rồi server cập nhật kết quả. Trong phòng Duo, ngoại lệ chỉ bắt đầu khi tất cả người đang thi đã được chấp nhận nộp cuối. Một người đang được chấm nhưng người kia còn trả lời vẫn phải giữ trang, cùng Companion; các phần Duo chưa nộp hết vẫn chịu quy tắc giữ trang. Lỗi provider giữ nội dung/bản ghi để xử lý hoặc chấm lại. Nếu server mở lại phần trả lời sau lỗi chấm, quy tắc giữ trang áp dụng trở lại.

Không xử phạt `window.blur`: hộp thoại cấp quyền microphone hoặc hộp thoại hệ điều hành không phải chuyển tab. Trình duyệt không phát hiện tin cậy tab của origin khác vừa mở nhưng chưa được chọn nếu trang thi chưa bị ẩn. Đây là quy tắc dựa trên vòng đời trang, không phải giám sát mọi hoạt động của máy.

## Xem kết quả

Sau khi hoàn thành placement, bài luyện hoặc đề thi, trang kết quả hiển thị tất cả câu khách quan, bao gồm câu bỏ trống: đề bài/ngữ cảnh, lựa chọn, câu trả lời của người học, đáp án đúng, biến thể được chấp nhận, giải thích và dẫn chứng. Có bộ lọc tất cả/sai/chưa trả lời. Đáp án nhóm chọn nhiều được trình bày thành các lựa chọn dễ đọc.

Placement lưu đúng câu hỏi đã được chọn thích ứng và snapshot đáp án khi trả lời; kết quả mở sau khi hoàn thành hợp lệ hoặc hết thời gian. Quick 15 câu/20 phút, Deep 30 câu/40 phút; deadline được lưu server. Reload hủy lượt đang trả lời thay vì mở lại cùng câu hỏi. Câu đang xem được lưu với lựa chọn nháp hoặc đáp án bỏ trống; không tạo câu đã làm cho các câu chưa từng được phục vụ. Ít hơn 5 câu trả lời thì band null, không cập nhật hồ sơ/lộ trình. Có thể mở lại placement đã hoàn thành từ lịch sử. Lượt bị hủy không tạo điểm đạt hoặc cập nhật band; bắt đầu lại không hiển thị key của lượt cũ trong bài đang làm.

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

Thay đổi giữ trang và thay đề trong tài liệu này **chưa được xác nhận đã triển khai trên VPS**. Chỉ kết quả kiểm tra trên môi trường cloud được ghi trong [validation.md](validation.md); cần receipt triển khai và hậu kiểm HTTPS thực tế của đúng commit để xác nhận bản live.

## AI riêng của bản cài

Cấu hình key/model được đóng gói dạng ciphertext AES-256-GCM, không chứa key plaintext. Khóa mở được dẫn xuất HKDF từ hai hash scrypt riêng của bản cài và salt ngẫu nhiên; AAD ràng buộc phiên bản và HTTPS origin. Updater mở thử cấu hình trong container offline chỉ đọc, trước khi dừng app hoặc ghi database. Nếu không khớp, app cũ tiếp tục chạy và cập nhật dừng.

Runtime mở key trong bộ nhớ backend sau khi xác minh credentials; env key riêng luôn được ưu tiên để thay key. Khi đổi hash credentials cần cấu hình key env mới. Health chỉ cho biết cấu hình, không phải provider probe. Bộ chấm Writing dùng dữ liệu hình thật; Speaking dùng Whisper và `gpt-audio` nghe WAV, kiểm timestamp và dẫn chứng trước tính trung bình bốn tiêu chí. Transcript-only không được suy ra phát âm. Các lỗi quota/provider/schema giữ bài/bản ghi để chấm lại.
