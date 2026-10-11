# Kết quả kiểm tra

## Build trên VPS ít RAM — 2026-10-11

VPS báo `MemAvailable` 1661 MiB nên guard 2 GiB của bản trước dừng trước tải/build, dừng app hoặc ghi database. Bản sửa giảm giới hạn build từ 1024 xuống **512 MiB**, giữ **1024 MiB dự phòng**: build/manifest/CLI cần tối thiểu 1536 MiB. Đọc lại RAM trước từng bước và trước mutation marker; giới hạn khởi động lấy từ app đang chạy, đối chiếu với Compose, không dùng giá trị mặc định thay thực tế. Giữ nguyên policy khôi phục trước mutation và offline sau mutation.

**Native Docker cgroup v2, Node 24.21.0: toàn bộ quy trình đạt trong 71 giây**, giới hạn 512 MiB, swap bổ sung bằng 0, CPU 0.5. Cài frozen lockfile từ cache đầy đủ đã xác minh integrity, kiểm TypeScript client/server tuần tự, Vite production bundle, prune dev dependencies và đọc toàn bộ seed manifest đều exit 0. Peak cgroup 512 MiB bao gồm file cache; có page reclaim, **không OOM/kernel kill**, Docker `OOMKilled=false`. Heap 384 MiB chỉ nằm trong build stage; runtime manifest bỏ `NODE_OPTIONS`, vẫn xác minh đủ 322 content/270 lessons/52 mocks/216 vocabulary/160 placement và ID không trùng. Đây là kiểm tra quy trình trong container giới hạn tài nguyên, không phải chứng minh build/download hay deployment đã chạy trên VPS. Docker daemon/context nằm ngoài hạn mức của build container; phần RAM dự phòng dành cho hệ thống và tải khác.

**142/142 kiểm thử triển khai đạt, không skip**, gồm 50 trường hợp mới về ngưỡng KiB chính xác, RAM thay đổi giữa các bước, giới hạn app 512/768 MiB, dữ liệu MemAvailable lỗi, thứ tự dừng/backup/mutation/startup và xử lý lỗi. Chạy chính Bash/awk/Python của các wrapper; hai verifiers chạy với JSON từ Compose thật, chấp nhận `mem_limit` dạng số hoặc chuỗi decimal canonical và từ chối sai giới hạn/file build. Compiler options hai cấu hình release khớp cấu hình chính; hợp các source files khớp toàn bộ production source, với tests được loại như `.dockerignore` vốn có. Full `npm run typecheck` cũng đạt. Dockerfile mặc định vẫn kiểm tra đầy đủ source/test. Không đổi dependencies hoặc lockfile.

API/Vite development hiện có vẫn healthy với ngân hàng fresh v2; không seed/reset hoặc sửa database học viên trong lượt sửa RAM. Scan source/bundle không có identity material riêng. HTTPS public vẫn là ngân hàng legacy 544/84/744/640; bản sửa được chuẩn bị cho lệnh SSH ghim source/checksums, chưa xác nhận triển khai thực tế trên VPS. Không chạy lại các suite app/browser đã đạt ở bản trước vì không đổi ứng dụng, giao diện hoặc học liệu.

## Đề mới và đáp án sau nộp — 2026-10-11

Bộ `fresh-20261011-v2` có **270 bài luyện, 52 đề, 216 mục từ và 160 câu đầu vào**. Thêm 16 đề đầy đủ, bốn mỗi kỹ năng; giữ nguyên nguồn/task/key của toàn bộ 306 học liệu fresh trước đó. Đáp án khách quan sau nộp gồm câu hỏi/ngữ cảnh/lựa chọn, câu trả lời, key/biến thể, giải thích/evidence, kể cả câu bỏ trống. Placement lưu snapshot đúng câu thích ứng và mở lại từ lịch sử; lượt mới vẫn ẩn keys. Writing/Speaking có mẫu theo từng Task/Part chỉ sau nộp, kể cả khi AI offline và band `null`.

Cả ba audit đạt: cấu trúc, metadata, không trùng nguồn/task/hình/số liệu với ngân hàng hiện hành và lịch sử; **1.248 keys khách quan** chấm bằng grader thực. Audit references đạt **204 nội dung, 258 Tasks/Parts và 552 mẫu trả lời Part 1/3**, kiểm tra nguồn cũ không đổi, coverage, alignment, word minimum và trùng mẫu. Đọc QA độc lập đối chiếu toàn bộ **120 bài Writing và 598 câu/bài Speaking** với câu hỏi, gạch đầu dòng, số liệu, bản đồ và quy trình. Writing Task 1 dài 158–230 từ; Task 2 300–346; Speaking Part 2 207–234. Đây là ví dụ chưa có điểm giám khảo; một số báo cáo số liệu dùng cách diễn đạt theo công thức. Không khẳng định hiệu chuẩn band hay chất lượng provider live.

**345/345 Node tests đạt, không skip**, bật MongoDB/Docker thật trong namespace test riêng. Bao gồm post-submit disclosure/owner boundaries, đáp án placement theo đúng thứ tự thích ứng, active history/export không lộ key/model, SSE/offline/expiry, seed hai lần giữ private data/nội dung tự tạo/bài đã sửa/mẫu giáo viên, preserving backup fences, SHA/metadata/concurrent writes và routing helper. Legacy reset bị chặn nếu bộ fresh xuất hiện trước hoặc trong backup, kể cả khi tổng counts bị bổ sung cho giống bộ cũ.

**44/44 Playwright tests đạt trong một lượt cuối duy nhất**, desktop và mobile. Bao gồm placement hoàn thành/xem lại/bắt đầu mới, tất cả/sai/bỏ trống, grouped selections dễ đọc, Writing/Speaking mẫu chỉ sau nộp với AI offline, lộ trình Duo, deadline, lưu nháp, WAV, FSRS, bảy dạng Task 1 và campaign fonts/rewards. Map caption renderer sửa vị trí/line wrapping cho nhãn legacy; native SVG bounds chứng minh captions nằm trong khu vực và blank/road/north giữ vị trí. Stored map sources không thay đổi.

Database development thật được cập nhật qua CLI preserving với app offline: backup **10 collections**, receipt `complete`; thêm đúng **16 đề và references cho 196 học liệu cũ**, giữ nguyên **684 bản ghi trước đó**, bao gồm hai account cùng ID/hash. Verify backup và snapshot canonical độc lập đạt. Sau đó `scripts/cloud-setup.sh` chạy đầy đủ: frozen npm ci, official MongoDB, ba audit, strict TypeScript/Vite build và seed; snapshot sau setup/start vẫn khớp toàn bộ dữ liệu riêng và sources/keys cũ. Preview 5173/API3006 health đúng 270/52/216/160/version, Duo phone-only, demo tắt; không tạo bài làm/tiến độ giả để kiểm khởi động.

**VPS chưa cập nhật trong lượt này.** HTTPS công khai vẫn báo ngân hàng legacy 544/84/744/640; TCP SSH22 từ cloud bị `ConnectionRefusedError`. `run-exam-update.sh` ghim source/SHA và chọn reset chỉ với exact known legacy theo yêu cầu xóa cũ đã được cho phép; nếu đã có fresh v1/v2 thì chọn preserving update giữ mọi lượt học. Cả hai wrapper kiểm chứng đúng project và baseline, giới hạn tài nguyên, chỉ dừng/recreate app IELTS; MongoDB/proxy/host Nginx/TLS/project khác được giữ. Cần output/receipt từ lệnh SSH thật mới xác nhận public release. Logs/backups phát triển nằm riêng trong ignored `.local/exam-upgrade`.

## Thay toàn bộ ngân hàng, giữ hai tài khoản — 2026-10-10

Yêu cầu reset ở phiên trước thay thế việc giữ học liệu/lịch sử của các bản trước; các lượt học phát sinh sau reset phải được giữ. Bộ `fresh-20261011` gồm **270 bài luyện, 36 đề mô phỏng, 216 mục từ và 160 câu placement** mới. Các mục bên dưới là lịch sử kiểm tra; số lượng và trạng thái triển khai cũ không mô tả bản reset này.

`audit:content` và `audit:fresh` đạt: kiểm tra cấu trúc, dẫn chứng, giới hạn từ, dữ liệu hình vẽ, trùng nguồn/nội dung/số liệu và chấm **928 đáp án khách quan** bằng grader thực. Reading/Listening đủ dạng câu hỏi và cấu trúc đề; Writing đủ hai tasks và bảy dạng hình; Speaking đủ ba Parts. Nội dung có nhãn AI chưa được chuyên gia thẩm định; độ khó là ước lượng.

**222/222 Node tests đạt, không skip**, gồm MongoDB thực, reset giữ chính xác hai danh tính/hash, backup canonical EJSON/metadata, phát hiện ghi đồng thời trước xóa, guard không trộn seed cũ và nhánh lỗi của updater. Trình duyệt desktop/mobile: 26 luồng không bị ảnh hưởng đạt trong lượt đầy đủ; bốn luồng Reading được sửa fixture cho nguồn và widget của bộ mới rồi chạy lại, **4/4 đạt**. Đây là 30 luồng đã kiểm tra, không phải một lượt cuối duy nhất 30/30.

Entrypoint vận hành có thêm **25/25 kiểm tra** với Bash/Python thật và Docker/curl/mktemp được mô phỏng trong namespace tạm; chỉ ngữ cảnh quyền root được giả lập để chạy CI không đặc quyền. Kiểm tra từ chối sai project/danh tính/hash, giữ Unicode và ký tự shell nguyên văn, xác minh script SHA, không lộ credentials và dọn file private trên mọi nhánh lỗi. Đây là kiểm tra helper, không phải triển khai VPS.

Native Docker reset CLI đạt trên MongoDB riêng: image readonly, không capability, `/tmp` noexec, giới hạn 512 MiB/0,5 CPU. Giữ nguyên hai ID/hash, xóa người thứ ba, reset profile và mọi collection học; kiểm tra 13 bản backup cùng SHA/quyền 0700/0600. Container có sẵn giữ nguyên ID và thời điểm khởi động. Không dùng database học viên để kiểm thử.

Database development thật đã backup/reset và verify: đúng hai account, public data khớp bộ mới, dữ liệu riêng trống. Sau đó chạy thành công toàn bộ `scripts/cloud-setup.sh`: `npm ci` từ lockfile, MongoDB, hai audit, strict TypeScript/Vite build và seed; `bank:verify` vẫn đạt. API và Vite đã khởi động lại, `/api/health` báo MongoDB, phone-only Duo, demo tắt và bộ mới. Không tạo điểm/tiến độ giả để xác minh.

**VPS chưa reset trong lượt này.** HTTPS công khai `sutonghanyu.vn/api/health` vẫn trả 544/84/744/640; SSH22 từ cloud bị từ chối. `deploy/run-bank-reset.sh` đọc cấu hình hash riêng từ đúng app đang chạy, tải/checksum `reset-bank.sh` ghim commit rồi truyền qua file private, tránh nhập lại hoặc đưa thông tin đăng nhập vào shell history. Lệnh dành cho phiên SSH hiện có của người dùng; chỉ receipt complete cùng hậu kiểm VPS mới xác nhận triển khai.

## Giao diện chiến dịch Hỏa + Mộc — 2026-10-08

Production build TypeScript/Vite đạt. **30/30 Playwright tests** trên desktop 1440px và mobile 390px đạt, gồm toàn bộ 26 kiểm tra trước đó và bốn kiểm tra giao diện chiến dịch mới. Các trang đăng nhập, tổng quan, thư viện, thi thử, đầu vào, lộ trình, từ vựng, lịch sử, sổ lỗi và cài đặt tải được font/ảnh, không tràn ngang. Font Be Vietnam Pro tải được các trọng lượng dùng trong UI với mẫu tiếng Việt; các tiêu đề không dùng serif fallback hoặc khoảng cách chữ âm.

Sau chỉnh sửa nhỏ để caption minh họa dashboard tách hai dòng, production build và **4/4 kiểm tra chiến dịch** được chạy lại, đạt; ảnh preview đã được chụp từ bundle cuối này.

Kiểm tra bằng hai tài khoản tổng hợp trong MongoDB riêng xác nhận: một người hoàn thành chưa mở huy hiệu chung; cả hai hoàn thành mở đúng huy hiệu đầu tiên; một người đạt Gate chưa mở chặng sau, cả hai đạt mới mở huy hiệu Gate và các buổi kế tiếp. Chọn quân cờ chỉ đưa tới thẻ buổi học, không ghi tiến độ hay bỏ qua khóa. Các kiểm tra bài đọc, nghe, biểu đồ, sơ đồ, nháp Writing, WAV Speaking, lịch sử và FSRS cũ vẫn đạt.

**30/30 kiểm tra updater**, không skip, gồm native MongoDB, đạt sau khi thêm đối chiếu CSS, WebP/SVG và WOFF2 qua HTTPS theo MIME, dung lượng và SHA256 của image đã build. Kiểm tra từ chối trang HTML200 giả tài nguyên, font sai nguồn và CSS cũ dù cùng dung lượng. Không chạy triển khai VPS trong lượt kiểm tra này; cloud vẫn không kết nối được SSH22 tới VPS. HTTPS công khai hiện xác nhận website đang dùng Duo phone auth và ngân hàng 544/84/744/640; đây chưa phải bằng chứng giao diện chiến dịch đã lên live.

Thay đổi giao diện không sửa mã backend, seed hoặc ngân hàng học liệu. Font được đóng gói cùng website với giấy phép OFL; không yêu cầu truy cập Google Fonts. Ảnh preview dùng tài khoản tổng hợp, không chứa thông tin đăng nhập thật.

## Duo và học liệu band 7.5–8.0 — 2026-10-08

Hai tài khoản cố định đăng nhập bằng số điện thoại, với tên và mục tiêu 8.0 từ cấu hình riêng chứa hash scrypt. Không có số điện thoại hoặc mật khẩu thật trong source/bundle. Session cũ chưa gắn đúng danh tính không thể đăng nhập vào bản Duo. Kho bài và thi thường mở độc lập; backend bảo vệ riêng tiến độ lộ trình, Gate và kỳ thi nâng band.

Lượt kiểm tra cuối trên source đã chốt đạt **172/172 Node tests, không skip**, với native Mongo cho updater/verifier; **26/26 Playwright desktop/mobile**; TypeScript và build Vite đạt. Production Node được chạy riêng với MongoDB thật và cấu hình Duo private: health phone-only, demo tắt, ngân hàng đúng số lượng, anonymous user null, đăng ký bị từ chối, SPA và JavaScript 415.010 byte phục vụ đúng. Kiểm tra này không tạo điểm hoặc tiến độ học giả và không triển khai lên VPS.

Setup cloud được chạy lại thành công từ lockfile: `npm ci`, MongoDB ping, cả ba audit, production build và seed. Hash các collection cá nhân sau setup khớp receipt development trước đó; không xóa dữ liệu để kiểm tra startup.

Ngân hàng đạt **544 bài luyện, 84 đề mô phỏng, 744 mục từ và 640 câu placement**. Bổ sung 64 bài luyện, 12 đề, 96 mục từ và 64 câu placement. Audit đối chiếu đúng hash nguồn của toàn bộ 552/648/576 bản ghi v3, chấm đủ 784 đáp án khách quan mới, kiểm tra dẫn chứng, giới hạn từ, bố cục, workload đề và hình vẽ. Không phát hiện nguồn hoặc hình mới trùng nguyên bản hay overlap Reading/Listening vượt ngưỡng 55% theo cụm 5 từ. Đây là kiểm tra tự động; nội dung vẫn có nhãn AI chưa được chuyên gia thẩm định và độ khó ước lượng.

MongoDB test thực chứng minh seed chỉ thêm ID mới, giữ nguyên mọi học liệu cũ, kể cả các ID đã chỉnh sửa và học liệu thêm riêng. Hai lượt seed giữ nguyên 13 collection riêng, gồm bốn collection Duo, cùng ghi âm GridFS 4096 byte/32 chunk. Khi cập nhật database development thật, toàn bộ 552/648/576 tài liệu cũ và dữ liệu cá nhân giữ nguyên; provisioning bổ sung đúng hai tài khoản cố định, không xóa tài khoản legacy hoặc tiến độ.

Kiểm thử backend bao gồm MIN placement, placement lại không reset, bằng chứng hoàn thành cá nhân, Gate bảo lưu pass, phòng thi hai Ready, đồng hồ server, pending AI, Companion/strict retake, band 7.5 → 8.0 và nâng band nguyên tử. Chấm lại chỉ dùng bài/âm thanh đã lưu của chủ tài khoản; dữ liệu nộp sau hạn bị từ chối. Provider transport trong tests được kiểm soát, không phải gọi chấm AI live.

Bài nâng band Writing yêu cầu đủ các task và điểm AI của từng task. Nộp/chấm dùng lease MongoDB riêng và đối chiếu đúng bản làm, nên autosave hoặc upload từ phiên khác không đổi nguồn đang chấm. Worker hết hạn không thể thay/xóa ghi âm mới; API và JSON export không lộ token lease. Phòng thi giữ lượt đang được chấm hợp lệ qua hạn nộp, còn lease bỏ dở hết hạn cho phép thi lại. Năm tình huống race được chạy qua hai app instance trên cùng database test.

`deploy/update-duo.sh` đã kiểm tra bằng Compose thực và MongoDB test, gồm payload toàn ngân hàng trên 7 MiB, helper regular-file 0600 và hash của collection Duo/cá nhân/ghi âm. Script chỉ thay app IELTS, giữ MongoDB, proxy, host Nginx, chứng chỉ, cấu hình và project khác. Bản Duo **chưa được triển khai trên VPS** trong lượt kiểm tra này; cloud không có kết nối SSH vào VPS, người dùng cần chạy lệnh đã ghim commit/checksum trong phiên SSH hiện có.

Chưa có credentials để kiểm tra provider AI live. Writing/Speaking trong kỳ thi nâng band chờ kết quả AI hợp lệ; Speaking cần bằng chứng âm thanh phù hợp. Không thay bằng điểm giả. Build Node/Vite và trình duyệt chạy trực tiếp trên cloud; hạn chế CA proxy của Docker build nêu bên dưới vẫn áp dụng.

## Xác minh cập nhật VPS và sửa lỗi EAGAIN — 2026-10-08

Người dùng đã chạy updater v3 trên VPS: build production đạt và app mới đang phục vụ. Kiểm tra độc lập qua HTTPS công khai xác nhận `https://sutonghanyu.vn/api/health` trả MongoDB, demo tắt và ngân hàng 480/72/648/576; session anonymous và JavaScript build cũng trả đúng. Đây là bằng chứng website mới đang chạy, chưa phải bằng chứng so sánh từng bản ghi cũ hoặc toàn bộ baseline trên VPS.

Lượt updater gốc dừng khi `mongosh` đọc manifest 7.963.147 byte trực tiếp từ Docker stdin: fd 0 trở thành nonblocking, khiến `fs.readFileSync(0)` báo `EAGAIN`. Cùng lỗi này làm guarded rollback từ chối xử lý; không phải bằng chứng học liệu bị thiếu. Đã tái hiện bằng manifest đầy đủ với MongoDB thực, không chỉ fixture nhỏ.

`deploy/update.sh` sửa ba truy vấn nhận payload bằng helper chuyển dữ liệu tới file tạm riêng quyền 0600 trong đúng Mongo container, xác minh kích thước/SHA256, dùng regular-file stdin và tự dọn file. 22 kiểm thử updater đạt, gồm xác minh toàn bộ manifest và guarded rollback nhiều MB trong database test riêng; dữ liệu học tập được đối chiếu giữ nguyên. Không thay đổi điều kiện an toàn của rollback.

`deploy/verify-update.sh` dành riêng cho app commit `3e6037bf7da2d9ddf5e84b4193353f7a721e9bc9` đã chạy. Script chỉ đọc các collection public, so sánh toàn bộ seed và bản ghi public cũ bằng canonical EJSON, đối chiếu image/digest/release/origin/loopback, HTTPS/assets và baseline container/cổng/cấu hình. Nó chỉ tạo receipt riêng và file tạm; không build, seed, restart, thay đổi database, proxy, host Nginx hoặc firewall. PID Nginx được kiểm tra giữ nguyên trong lượt xác minh; cấu hình được đối chiếu với audit trước cập nhật. Người dùng đã gửi kết quả xác minh đạt trên VPS: 552/648/576 seed khớp, 184/216/192 bản ghi cũ giữ nguyên, baseline container/cổng/cấu hình đạt. Đây là receipt của bản v3, không phải bằng chứng bản Duo đã triển khai.

21 kiểm thử verifier đạt, gồm các nhánh thiếu/thay đổi bản ghi, custom material, BSON, audit selection và image parser từ heredoc thật. Truy vấn verifier thật nhận 10.549.633 byte qua stdin regular-file quyền 0600 trên MongoDB test: 552/648/576 bản ghi seed và 185/217/193 bản ghi cũ/custom khớp; hash của ba collection public và chín collection cá nhân giữ nguyên, file tạm được dọn. Lượt kiểm thử cuối bật native Mongo cho cả updater/verifier: **99/99 đạt, không skip**. TypeScript, cú pháp Bash và cả bảy Python heredoc đạt. Không chạy lại browser suite vì không thay đổi app/giao diện/học liệu.

## Mở rộng nội dung v3 — 2026-10-08

Node.js 24, MongoDB 8 và Chromium thực: `npm run build`, `npm run audit:content`, `npm run audit:expansion`, 76 kiểm thử Node và 22 kiểm thử trình duyệt desktop/mobile đều đạt. Lượt Node này bật cả hai trường hợp kiểm tra rollback bằng BSON/MongoDB thực qua `IELTS_UPDATE_GUARD_MONGO_CONTAINER=website-ielts-ai-mongo`; không có trường hợp bị bỏ qua.

Ngân hàng hiện có 480 bài luyện, 72 đề mô phỏng, 648 mục từ và 576 câu placement. Audit chấm đủ 3.776 đáp án khách quan mới; kiểm tra dạng bài, trích dẫn, giới hạn từ, thứ tự đáp án trong lời thoại, workload đề đủ 40 câu, hình vẽ và nhóm chọn nhiều đáp án. Không phát hiện section mới trùng nguyên văn hoặc cặp bài Reading/Listening mới có độ giao nhau 5-gram vượt 55% với nội dung cũ/mới. Kiểm tra tự động không thay thế việc thẩm định chuyên môn hay hiệu chuẩn độ khó; nội dung mới giữ nhãn `ai-unreviewed`.

Thử seed trên MongoDB thực trong database test riêng chứng minh giữ tài khoản, session, bài làm, flashcard, placement, lộ trình và GridFS recording qua hai lần seed. Khi cập nhật database development, đã đối chiếu hash của cả 9 collection cá nhân trước/sau, cùng toàn bộ 184/216/192 bản ghi public cũ: tất cả giữ nguyên, số lượng public sau cập nhật đạt 552/648/576.

Giao diện được kiểm tra với đủ bảy dạng Writing Task 1, bản đồ/sơ đồ Reading/Listening, sáu bố cục completion, chọn nhiều đáp án, resume và ẩn đáp án/lời thoại trong Exam. Sơ đồ snow fence được kiểm tra riêng để chú giải tự suy ra từ đường vẽ không làm lộ đáp án.

`deploy/update.sh` đã qua 20 kiểm thử riêng, gồm preflight chỉ đọc với Docker mô phỏng và rollback với MongoDB/BSON thực; chưa chạy trên VPS trong đợt mở rộng này. Kiểm tra public cho thấy `https://sutonghanyu.vn/api/health` vẫn trả ngân hàng cũ 160/24/216/192. SSH cổng 22 từ cloud bị từ chối, nên cần chạy lệnh cập nhật đã ghim commit/checksum trong phiên SSH của người dùng. Không suy diễn kiểm tra cloud thành triển khai thành công trên VPS.

Dockerfile production được thử build với giới hạn 1024 MiB RAM, không swap và 0,5 CPU. `npm ci` trong image Node chính thức bị chặn bởi `SELF_SIGNED_CERT_IN_CHAIN`: image chưa có CA của proxy HTTPS trong cloud. Thử mạng host vẫn gặp cùng lỗi; không tắt xác minh TLS, sửa Dockerfile hay cấu hình DNS để né lỗi. Chưa tạo được image production trong cloud. Build Node/Vite và manifest trực tiếp trên host đạt, gồm 105 visuals và 345 nhóm câu hỏi; container MongoDB không đổi. Script cập nhật VPS tự build và kiểm tra image trước khi dừng app cũ.

## Kiểm tra phiên bản trước — 2026-10-07

Đã chạy trong cloud workspace ngày 2026-10-07, bằng Node.js 24, Chromium và MongoDB 8.0.32 thực.

| Kiểm tra                                            | Kết quả                                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `bash scripts/cloud-setup.sh`                       | Đạt: `npm ci` từ lockfile, MongoDB ping, seed idempotent, audit và production build                             |
| `npm test`                                          | 41/41 đạt, không skip                                                                                           |
| `npm run test:e2e`                                  | 16/16 đạt: tám luồng trên desktop 1440 px và mobile 390 px                                                      |
| Kiểm tra lại các luồng learning sau mở rộng Reading | 8/8 đạt trên hai kích thước màn hình                                                                            |
| `npm audit --omit=dev --audit-level=high`           | Không phát hiện lỗ hổng dependency                                                                              |
| Production Node/Express                             | Đạt: MongoDB kết nối thực, SPA/deep link và JavaScript assets được phục vụ, demo tắt, CSP có private blob audio |

Các API tests dùng database riêng và kiểm tra đăng ký đồng thời tối đa hai tài khoản, owner isolation, cookie session/hash, resume qua khởi động lại, draft updates, nộp đồng thời/idempotency, 40-item reference grading, CAT quick/deep, FSRS, server deadline, exam nghe một lượt, Writing/Speaking chưa có band khi offline, SSE và private GridFS recording 17 MB.

Browser tests chạy thật giao diện/API/MongoDB: tài khoản/hồ sơ/lộ trình, lịch sử riêng, thư viện và bài Reading, kiểm tra đầu vào 15 câu, thi Reading 40 câu/timeout, Writing hai tasks/biểu đồ/draft, Speaking microphone WAV/retry/SSE, Listening practice transcript và exam một lượt. Browser fake microphone cung cấp audio vào pipeline thu âm thực để kiểm tra định dạng/lưu trữ; đây không phải kiểm định phát âm của người học. Kiểm tra không có browser exceptions bất thường hay horizontal overflow.

AI adapters được kiểm tra bằng transport kiểm soát: exact evidence quotations, trọng số Writing Task 2, provider failures, Whisper multipart, acoustic-only constraints, Azure continuous recognition thời lượng 12 phút, ElevenLabs voice mapping, và schema/critic validation của bài sinh thêm. **Chưa có credentials để gọi OpenAI, Azure hoặc ElevenLabs live.** Các kiểm tra này không xác nhận chất lượng chấm AI hay voice thực tế.

Audit nội dung xác nhận 160 lessons, 24 mocks, 216 mục từ và 192 placement items; IDs, câu hỏi, đáp án, evidence, word limits, cấu trúc và Reading workload. Học liệu vẫn chưa được giám khảo thẩm định hay hiệu chuẩn tâm trắc.

Docker MongoDB đã chạy/ping/restart với dữ liệu bền vững. Dockerfile ứng dụng được cung cấp nhưng container build chưa xác minh hoàn tất trong cloud này: npm registry không resolve được từ container. Production Node chạy trực tiếp trong workspace đã được kiểm tra riêng. Không triển khai public hosting hoặc URL preview bên ngoài.

Database dùng cho tests được cô lập với database development và xóa sau từng run. Các ảnh trong [preview.md](preview.md) là ảnh chụp trình duyệt, không phải mockup thiết kế.
