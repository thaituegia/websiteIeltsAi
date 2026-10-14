# Kết quả kiểm tra

## Sổ từ trong bài làm và nghĩa khi xem lại — 2026-10-14

Thêm chọn từ trực tiếp trong bài học, thi và placement: lưu một từ/câu gốc vào sổ riêng trước nộp, chỉ mở nghĩa theo ngữ cảnh sau khi hoàn thành hợp lệ. Không mở tab mới, đổi đáp án hoặc đặt lại đồng hồ. Từ chờ nghĩa chưa được ôn FSRS; bổ sung nghĩa giữ lịch và lịch sử. Bản cập nhật không thay ngân hàng đề, rank/lộ trình hoặc khóa provider.

**55/55 kiểm tra native đạt** trên MongoDB thật trong namespace tổng hợp riêng, gồm 18 kiểm tra HTTP của sổ từ và hồi quy API, placement timing, Duo/integrity. Bao phủ owner, nguồn/câu hiển thị, transcript ẩn, chống trùng và đồng thời, mock provider/cache/timeout/retry, chặn tra trước nộp, hủy trong lúc provider đang xử lý, ngữ cảnh đa nghĩa, giữ FSRS, và phần Duo đã nộp nhưng lease của cả lượt vẫn còn hoạt động/hết hạn/reset chưa hoàn tất.

**6/6 kiểm tra trình duyệt tính năng mới đạt**: ba tình huống trên desktop và mobile, gồm thi có giám sát, lưu lại/ngữ cảnh mới, sổ từ sau reload, retry và bỏ phản hồi khi phần hiển thị đã đổi, nghĩa inline và cô lập hai người; placement hoàn thành thật và mở lại review. Hồi quy bài mẫu Writing/Speaking, đáp án placement/chọn nhiều và FSRS: 9/10 đạt ở lượt đầu; một tình huống Speaking mobile gặp lỗi dịch vụ tại dashboard trước khi mở bài, chạy lại riêng đạt. Không sửa hay nới assertion để bỏ qua lỗi đó.

Strict TypeScript và Vite release build đạt. Các transport OpenAI đều bị mock hoặc vô hiệu hóa trong fixture; không gọi API trả phí, không thao tác tài khoản học thật. Snapshot xác nhận giữ nguyên 700 bản ghi nền và indexes trong 10 collection của database phát triển; quét mã public/frontend không có khóa hoặc danh tính riêng. Logs ở ignored `.local/word-notebook`. Đây là kiểm tra cloud; cần chạy updater trên VPS để áp dụng production.

## Chibi và lộ trình cá ngựa — 2026-10-12

Toàn bộ giao diện dùng kem, san hô, mint, lilac và vàng nhẹ, với minh họa chibi mới, logo/avatar/favicon cá ngựa và font Be Vietnam Pro được phục vụ tại chỗ. Bàn cờ có hai quân khác màu, tên đầy đủ trong bảng tiến độ và nhãn truy cập; vị trí là buổi chưa hoàn thành tiếp theo hoặc mốc chờ theo dữ liệu riêng của mỗi người. Một người học xong chỉ di chuyển quân của người đó; Gate chưa đủ hai kết quả đạt vẫn giữ các buổi tiếp theo khóa. Chọn ô chỉ cuộn/focus thẻ buổi học, không ghi tiến độ.

**20/20 kiểm tra trình duyệt đạt trong 2,1 phút**, desktop/mobile, gồm chín trang chính, font/asset/bố cục, huy hiệu theo kết quả thật, hai quân tiến độc lập, nội dung Reading/Listening/chart/map, xác nhận kiểm tra, practice resume và chuyển phần thi có giám sát. Sau sửa nhỏ nhãn cùng ô trên điện thoại, rebuild rồi chạy lại riêng hai tình huống cá ngựa: **2/2 đạt trong 30,1 giây**, kiểm tra nhãn không đè nhau hoặc tràn khỏi bàn cờ. Các ảnh cuối đã được xem trên cả hai kích thước; screenshot bàn cờ chỉ ẩn mobile bar tạm thời để xuất hình, không đổi thanh điều hướng của sản phẩm.

**Pipeline native trên source cuối đạt trong 77 giây**: cached frozen `npm ci --offline`, strict TypeScript client/server + Vite, prune và full seed manifest; **512 MiB RAM, không thêm swap, CPU 0.5, network none**, peak chạm giới hạn nhưng OOM/OOM-kill bằng 0. Cả 343 input source khớp lúc hậu kiểm; sau đó chỉ bổ sung tài liệu/ảnh preview. Manifest giữ đúng **966 content / 810 bài luyện / 156 đề / 648 từ / 480 câu placement**. Bằng chứng ở ignored `.local/chibi-release/bounded-build-v2`; bản sao app của proof đã được dọn riêng sau khi container kết thúc. Đây là pipeline dùng cache, chưa phải full-network Dockerfile build hoặc triển khai VPS.

Backend, học liệu, tài khoản, bài làm, audio, AI và quy tắc giữ trang không đổi. Snapshot canonical vẫn giữ toàn bộ 700 bản ghi nền trong 10 collection; tests chỉ dùng tài khoản tổng hợp/database riêng. Không lặp lại suite Node backend vì không đổi logic backend. Kiểm tra HTTPS chỉ đọc xác nhận VPS đang có ngân hàng v3, giám sát và cấu hình OpenAI; chưa chứng minh giao diện chibi đã triển khai. Ảnh preview chỉ chứa tài khoản tổng hợp: [tổng quan](screenshots/chibi-desktop-dashboard.png), [bàn cờ máy tính](screenshots/chibi-desktop-board.png), [bàn cờ điện thoại](screenshots/chibi-mobile-board.png).

## Giữ trang kiểm tra và thay bộ câu hỏi — 2026-10-11

Phạm vi cuối là **placement, lượt `mode: exam`, Duo Gate và thi nâng band**. Practice thông thường vẫn tự lưu/resume qua điều hướng, tab ẩn và reload. Lượt kiểm tra đang trả lời bị hủy khi trang bị ẩn, rời/reload/đóng trang, có trang website đã đăng nhập cùng tài khoản khác hoặc mất heartbeat quá lease **25 giây**. Vi phạm trong phòng chung đang thi hủy lượt hiện tại của cả hai, kể cả Companion; trước bắt đầu, rời trong lúc chuẩn bị/đếm ngược bỏ Ready và đưa phòng về chờ. Bài hoàn thành, điểm, tiến độ và pass cũ được giữ.

Full Node suite đạt **476/476, không skip**, gồm **11/11 kiểm tra phiên thi**, **5/5 kiểm tra HTTP**, **4/4 kiểm tra race của lease**, **9/9 kiểm tra replacement** và **10/10 kiểm tra Duo**. Full Playwright đạt **92/92 trong một lượt cuối**: **46/46 desktop và 46/46 mobile**, gồm **22/22 kiểm tra integrity ở mỗi viewport** cùng 48 tình huống hồi quy cũ. Bao phủ reload/chuyển tab/điều hướng/tab cùng tài khoản, mất lease, từ chối phiên cũ, bảo lưu lịch sử/pass, practice resume, chờ AI sau nộp cuối, Companion/Ready/phòng chung, hồi phục lỗi provider, race hoàn tất placement/chuyển pha chấm và các giới hạn sự kiện trình duyệt.

Replacement tests kiểm tra bộ câu hỏi có nguồn thật mới cho **toàn bộ 966 học liệu seed** khi loại nguồn ban đầu; giữ nguồn/key/model gốc bất biến, không tái dùng câu/source bằng cách đổi ID, ánh xạ mọi section/question/blank/block/visual/group/reference, cấu trúc 40 câu và từ chối ngân hàng hết nguồn bằng **409**. Full mocks giữ số phần/vai trò/thời lượng; lessons có khối lượng và nhóm dạng câu hỏi tương đương, Grammar có thể đổi quy tắc ở cùng mức. CEFR gốc được ưu tiên; trường hợp Listening A2/band 3.5 duy nhất dùng mock B1/band 4.5 gần nhất với `difficultyFallback: true`, giữ band/CEFR và metadata độ khó thật của nguồn thay thế. Các nguồn đã dùng được loại trong lần thi lại tiếp theo.

Server chấp nhận nộp cuối rồi khóa câu trả lời và chuyển sang chờ chấm AI với lease **1.200 giây**. Lượt cá nhân trong pha chờ chấm hợp lệ không bị hủy bởi rời/reload trước khi provider trả kết quả. Phòng Duo chỉ có ngoại lệ khi tất cả người đang thi đã được chấp nhận nộp cuối; một người đang được chấm nhưng người kia còn trả lời vẫn chịu giám sát, cùng Companion. Nếu server mở lại phần trả lời sau lỗi chấm, quy tắc giữ trang áp dụng trở lại. Kiểm tra này dùng provider transport/fixtures kiểm soát, không khẳng định có lần gọi provider live mới.

`window.blur` không bị phạt, cho phép hộp thoại microphone/quyền truy cập. Tab origin khác mở nhưng chưa được chọn không bảo đảm tạo `visibilitychange`, nên trình duyệt không phát hiện tin cậy trường hợp đó. Các kiểm tra không phải bằng chứng giám sát mọi hoạt động ngoài trang hoặc chống gian lận tuyệt đối.

**Pipeline production native trên mã cuối đạt trong 86 giây:** Node 24.21.0 trong container mới, **512 MiB RAM, không thêm swap, CPU 0.5 và network none**. Frozen `npm ci --offline` từ cache có kiểm integrity, TypeScript client/server tuần tự + Vite release build, prune và full seed manifest đều exit 0. Peak theo phase lần lượt **490,4 / 512,0 / 146,8 / 227,9 MiB**; `OOMKilled=false`, các counter `oom`, `oom_kill`, `oom_group_kill` đều 0. Có page reclaim khi đạt hạn mức; peak bao gồm file cache. Manifest xác nhận **966 content / 810 lessons / 156 mocks / 648 vocabulary / 480 placement**. Cả 340 input hash khớp source tại hậu kiểm, gồm các sửa race guard, replacement và hồi phục lỗi provider. Sau hậu kiểm chỉ cập nhật Markdown để ghi kết quả/số kiểm thử; mã thực thi của snapshot v4 không đổi. Đây là bằng chứng pipeline dùng cache trong cgroup, không phải tải dependency mới, full Dockerfile build, runtime startup hoặc triển khai VPS. Report/input-output attestation và cgroup logs được giữ riêng tại ignored `.local/exam-integrity/bounded-build-v4`; bản sao source/build của proof được dọn sau khi container kết thúc.

Đối chiếu canonical xác nhận **700 bản ghi nền trong 10 collection giữ nguyên**. Quét **391 file công khai và 24 artifact frontend** không thấy credentials hoặc thông tin tài khoản riêng. API/Vite development báo ngân hàng v3 và bật `examIntegrity`; đây là môi trường cloud.

**Chưa xác nhận bản thay đổi này đã triển khai trên VPS.** Hậu kiểm HTTPS chỉ đọc vẫn báo bộ v2, chưa báo hỗ trợ `examIntegrity` và cấu hình OpenAI là false; cờ cấu hình không chứng minh khả năng gọi provider live. Không có claim cập nhật dữ liệu học viên thật hoặc chấm bài học viên thật từ các test synthetic. Receipt/HTTPS của đúng commit sau lệnh cập nhật thực tế vẫn là điều kiện để xác nhận bản live. Các mục dưới đây là bằng chứng lịch sử của các đợt trước; mô tả resume kiểm tra qua reload trong các mục lịch sử không phải hành vi mới.

## Bộ gấp ba, chấm AI và bài đầu vào có thời gian — 2026-10-11

Ngân hàng `fresh-20261011-v3` có **810 bài luyện, 156 đề, 648 mục từ và 480 câu đầu vào**. Tất cả 322 học liệu, 216 từ và 160 câu đầu vào của v2 được giữ nguyên, gồm nguồn, key, mẫu và liên kết từ vựng. Thêm 644/432/320 ID riêng; số bài và số câu theo từng kỹ năng đều gấp ba. Bộ hiện tại có **3.744 câu khách quan** (1.152 Reading, 1.920 Listening, 672 Grammar), **774 Tasks/Parts tham khảo và 1.656 câu trả lời phỏng vấn**.

Cả ba audit cấu trúc/nguồn/key/references đạt. Grader thực chấm đúng mọi key và biến thể; bài đọc/nghe độc lập với bộ hiện tại và bộ lịch sử. Rà soát đã thay đoạn kéo dài chung bằng ví dụ riêng cho từng nguồn, viết lại mẫu essay theo lập luận riêng, kiểm số liệu/model/bản đồ/quy trình, giới hạn từ và các dạng câu hỏi. Band/CEFR là ước lượng dạy học, không phải hiệu chuẩn hay thẩm định của giám khảo.

**437/437 kiểm thử Node đạt, không skip**, với MongoDB/Docker thật và namespace giả riêng. Bao phủ giữ mọi BSON/index, custom/teacher edits, backup/hash/receipt/idempotence, câu hỏi/model chỉ mở sau nộp, owner isolation, deadline/draft race, regrade, rubric/evidence/timestamp, cấu hình key mã hóa và các guard triển khai. Bài đầu vào nhanh 15 câu/20 phút và sâu 30 câu/40 phút giữ deadline khi reload, tự kết thúc, chỉ mở câu đã được phục vụ và không xác định band khi ít hơn 5 câu trả lời.

**48/48 Playwright scenarios đạt trong một lượt cuối**, cả desktop/mobile, gồm lưu lựa chọn/deadline bài đầu vào qua reload và tự hết giờ; đáp án/mẫu sau nộp; độc lập Duo; thi nâng band cùng nhau; WAV/FSRS; giao diện tiếng Việt và hình thật của bộ gấp ba. Kiểm tra bản đồ trước/sau, quy trình, biểu đồ kết hợp và blank đánh số không lộ key khi đang làm, nhãn nằm trong SVG và không tràn ngang. Phép đo nhãn dùng CTM về hệ tọa độ viewBox để bao phủ nhóm SVG có translate.

API OpenAI thật đã chấm một Writing mẫu và âm thanh tổng hợp 23 giây: nhận phản hồi đủ bốn tiêu chí, timestamp Speaking hợp lệ; không dùng bài làm/ghi âm học viên. Khóa không xuất hiện trong frontend/source công khai; payload AES-GCM chỉ mở với hash riêng của bản cài. Kiểm tra 380 source files và 24 build files không phát hiện key/tên/số điện thoại/password/hash thật. `duoId` trùng một hằng fallback công khai có sẵn, được phân loại là metadata, không phải secret. Import graph frontend không tải module server. Các kiểm thử transport giả được phân biệt với bằng chứng API thật.

**Pipeline native đạt trong 85 giây ở 512 MiB RAM, không swap bổ sung, CPU 0.5**: frozen npm ci từ cache đã kiểm integrity, TypeScript client/server tuần tự, Vite production, prune dev dependencies và full manifest 966/648/480. Cgroup có page reclaim, OOM/kernel-kill bằng 0, Docker OOMKilled=false. Đây là chứng minh pipeline trong cgroup, không phải full download/Dockerfile/deployment trên VPS; overhead Docker daemon/context nằm ngoài cgroup và được guard giữ 1024 MiB dự phòng.

**Runtime image thật đạt inspect → apply → verify → USER node startup → verify** trên MongoDB synthetic riêng. So sánh BSON nghiêm ngặt và index xác nhận giữ mọi 717 document cũ trong 17 collections, kể cả custom/teacher edits, hai tài khoản giả và GridFS. Runtime chỉ copy đúng năm đường dẫn của Dockerfile, không có tsconfig; 8.460 file và ba symlink khớp production inputs. CLI readonly/root/cap-drop ALL/no-new-privileges/pids64/512 MiB/no-extra-swap/0.5 CPU đạt; peak inspect/apply/verify khoảng 137/166/155 MiB, không OOM. SPA/JS/CSS/SVG đúng status/type, health v3 đúng counts; không tạo bài làm của người học thật.

Preflight mở key riêng đã được thử đúng lệnh operator: **128 MiB/no-extra-swap/0.25 CPU, network none, readonly, cap-drop ALL**, credentials chỉ đọc; chỉ in boolean xác minh, không gọi API. Native test phát hiện TSX cần scratch cache khi root filesystem readonly, nên operator bổ sung tmpfs `/tmp` 32 MiB/nosuid/nodev/noexec. Lệnh chính xác sau sửa đạt; hai regression tests thực thi đoạn Bash, kiểm tài nguyên/quyền mount và dừng trước mọi thay đổi khi unseal lỗi. Không cấp thêm capability hoặc quyền ghi credentials.

Cập nhật development đã sao lưu mọi collection/index riêng và xác minh **700 bản ghi cũ giữ nguyên**, gồm hai tài khoản. Thêm đúng 644 học liệu, 432 từ và 320 câu đầu vào. Snapshot canonical riêng vẫn khớp sau setup idempotent/startup; không reset tiến độ hoặc session. Bằng chứng riêng ở ignored `.local/triple-bank`.

VPS đang xác nhận ở bản v2 `b0b8277cdcd86be2670510994948fbf6a4f7e584`. Lệnh v3 được ghim commit/checksums, chỉ nhận v2/v3 đầy đủ và thêm dữ liệu; không còn route reset. Cần receipt thực tế sau chạy SSH để xác nhận v3 trên VPS. Các mục dưới đây là lịch sử kiểm tra của các bản trước, không phải trạng thái triển khai hiện tại.

## Quyền source trong image triển khai — 2026-10-11

Log VPS sau build báo `ERR_MODULE_NOT_FOUND` tại `/app/server/data/index` ở bước inspect chỉ đọc; wrapper dừng trước khi dừng app hoặc xóa dữ liệu. Đã tái hiện đúng lỗi trong runtime Docker image: `umask 077` tạo thư mục học liệu 0700; `COPY --chown=node:node` chuyển chủ sở hữu sang `node`, nên CLI root không capability không đọc được thư mục. Manifest chạy bằng `node` vẫn đạt trong chính image lỗi. Kiểm tra pipeline trước đó chưa bao phủ quyền thư mục sau giải nén.

Hai wrapper nay chuẩn hóa riêng thư mục con source công khai thành 0755, kể cả parent không được liệt kê trực tiếp trong tar. Source root và mọi credentials/audit/backup giữ quyền riêng. Không đổi ứng dụng, dữ liệu, Dockerfile, tsconfig hoặc cấp thêm capability. **64/64 kiểm thử wrapper đạt, không skip**, gồm 20 kiểm thử mới chạy chính mã `PYEXTRACT` với `umask 077`, kiểm quyền/hash/chủ sở hữu private giữ nguyên và archive nguy hiểm bị từ chối trước mọi ghi/chmod. Full `npm run typecheck`, cú pháp Bash và `git diff --check` đạt.

**Native runtime image đã đạt inspect → apply → verify** trên MongoDB riêng, hai tài khoản giả và exact legacy bank. Dùng source production đối chiếu byte/hash với repo, dependencies/bundle đã build từ lockfile; runtime copy đúng danh sách của Dockerfile release, không có tsconfig. CLI giữ root, cap-drop ALL, no-new-privileges, filesystem readonly, pids 64 và tmpfs noexec; giới hạn 512 MiB, không thêm swap, CPU 0.5. RAM cao nhất lần lượt khoảng 131/186/100 MiB, không OOM. Verify xác nhận giữ đúng hai danh tính, dữ liệu học riêng trống và bộ fresh v2 đủ 270 bài luyện/52 đề/216 từ/160 câu đầu vào; backup thực vẫn 0700/0600.

Chạy `npm start` bằng USER node trong cùng image đạt API/MongoDB, phone-only Duo, demo tắt, SPA và JS/CSS/SVG thật, RAM cao nhất khoảng 194 MiB, không OOM. Container thử nghiệm chỉ dùng mạng riêng, không publish cổng và đã dừng sau kiểm tra; không dùng database học viên. Đây là bằng chứng runtime image và CLI, không phải full Dockerfile build/download trên VPS. Log và report riêng ở ignored `.local/inspect-diagnosis-temp`. Cần output/receipt từ lệnh SSH ghim commit/checksums mới xác nhận VPS cập nhật.

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
