# websiteIeltsAi — IELTS AI Duo

Website luyện IELTS bằng **React 19 + TypeScript + Vite**, **Node.js 24 + Express 5** và **MongoDB 8**. Hai thành viên đăng nhập bằng số điện thoại, học theo một lộ trình chung tới **band 8.0**, với bài làm và kết quả cá nhân được lưu riêng. Giao diện tiếng Việt, học liệu tiếng Anh; hỗ trợ Academic và General Training.

Yêu cầu trực tiếp của người dùng quyết định công nghệ và cách truy cập: **kho bài tập và đề thi thử luôn được làm riêng; chỉ kỳ thi nâng band cần cả hai cùng vào phòng**. Đặc tả Duo v1.1 bổ sung placement theo điểm thấp hơn, Duo Gate và bảo lưu kết quả đạt. [Ma trận yêu cầu](docs/requirements.md), [hợp đồng API](docs/api-contract.md), [cấu hình đăng nhập riêng](docs/duo-auth.md) và [kết quả kiểm tra](docs/validation.md) mô tả chi tiết.

Giao diện [chiến dịch Hỏa + Mộc](docs/campaign-design.md) dùng bản đồ hoạt hình, quân cờ và huy hiệu theo tiến độ thật của cả hai. Font Be Vietnam Pro hỗ trợ tiếng Việt được lưu trong dự án và phục vụ cùng website.

## Chạy local

Cần Node.js **24+**, npm, Docker/Compose và trình duyệt hiện đại.

```sh
npm ci
cp .env.example .env
npm run mongo:start
```

Chuẩn bị cấu hình **đúng hai tài khoản** trong kho secrets hoặc tệp riêng quyền `0600`, ngoài Git. Đặt `DUO_CREDENTIALS_FILE` thành đường dẫn tuyệt đối tới tệp đó trong `.env`; có thể dùng `DUO_ACCOUNTS_JSON` thay thế nhưng không cấu hình cả hai. Tệp chỉ chứa tên, số điện thoại, vai trò và **hash scrypt có salt**, không chứa mật khẩu nguyên văn. Xem [định dạng và provisioning](docs/duo-auth.md). Không dùng thông tin thật trong câu lệnh được lưu vào shell history.

```sh
npm run dev
```

Mở `http://localhost:5173`; API dùng cổng 3001. `PORT` đổi cổng API, `WEB_PORT` đổi cổng Vite; proxy giữ cùng origin cho cookie. Nếu dùng MongoDB/Atlas đã có, đặt `MONGODB_URI` qua secrets và bỏ bước `mongo:start`. Startup kiểm tra cấu hình Duo trước khi kết nối/seed, dừng nếu cấu hình thiếu hoặc không hợp lệ.

Đăng nhập chỉ nhận số điện thoại và mật khẩu đã cấu hình. Đăng ký, đăng nhập email và demo bị từ chối trong Duo. Tên và mục tiêu chung 8.0 là cố định; ngày thi, Academic/GT, thời lượng học và tự đánh giá cá nhân vẫn chỉnh được. Mật khẩu được băm scrypt; session ngẫu nhiên được lưu bằng hash trong MongoDB, gắn với phiên bản danh tính Duo. Cookie dùng HttpOnly/SameSite và Secure khi production. Thông tin thật không nằm trong client, Git hoặc bundle giao diện.

## Hành trình chung

| Phần | Hành vi |
| --- | --- |
| Placement | Quick 15 câu/20 phút hoặc Deep 30 câu/40 phút Reading/Listening thích ứng; mỗi người làm riêng. Lựa chọn được tự lưu, reload không đặt lại đồng hồ; hết giờ mở đáp án các câu đã gặp, dưới 5 câu trả lời chưa tạo band hay lộ trình. Chỉ tạo lộ trình khi cả hai hoàn thành; band bắt đầu dùng **MIN**, không lấy trung bình. Lộ trình có các bậc 3.0–8.0, mỗi bậc 0.5. |
| Band cá nhân | Giữ kết quả đầu vào và ước lượng cá nhân riêng. Làm lại placement hoặc luyện thêm không đặt lại hay tự nâng band chung. |
| Buổi học | Mặc định 20 buổi mỗi band; có cấu hình số buổi theo band. Cả hai cùng danh sách nhưng hoàn thành theo thời gian riêng; backend yêu cầu bằng chứng bài đã nộp của đúng người. |
| Duo Gate | Mặc định sau mỗi 5 buổi, có thể cấu hình 10. Cả hai hoàn thành chặng học trước Gate, rồi làm kiểm tra riêng. Hai kết quả đạt mới mở chặng sau; kết quả đạt của người trước được giữ khi người kia thi lại. |
| Thi nâng band | Mở sau khi cả hai hoàn thành buổi học và tất cả Gate. Cả hai join, đang có mặt và Ready mới đếm ngược. Các kỹ năng dùng lịch/hạn nộp chung trên server; mất kết nối và tải lại không đặt lại thời gian. |
| Kết quả nâng band | Mỗi người được chấm riêng. Chỉ khi cả hai đạt, backend đổi band chung đồng thời bằng cập nhật có kiểm tra revision; không lấy trung bình hai kết quả. Mục tiêu cuối là 8.0. |
| Thi lại | Bảo lưu kết quả đạt. Người đã đạt có thể vào phòng với vai trò Companion để đồng hành khi người kia thi lại; chế độ strict có thể yêu cầu cả hai thi lại. |
| Ôn tập | Ôn lại band đã mở và mở bất kỳ bài/đề thường trong kho mà không cần người kia online. Điểm luyện riêng không bỏ qua Duo Gate hoặc nâng band chung. |

Mức đạt Gate mặc định 70% câu hỏi khách quan. Thi nâng band cần từng kỹ năng đạt mức band kế tiếp, tối đa 8.0; Writing/Speaking phải có kết quả AI hợp lệ, không đổi band từ checklist hoặc điểm tự khai báo. Trạng thái `pending-ai` giữ bài để chấm lại sau, không coi là đạt. Speaking cần bản ghi thực tế và bằng chứng âm thanh hợp lệ: OpenAI Audio có thể chấm bốn tiêu chí; chỉ nhập transcript thì chưa có band toàn kỹ năng.

## Luyện tập hằng ngày

| Phần | Hành vi |
| --- | --- |
| Kho bài tập | Tìm/lọc kỹ năng, chủ đề, CEFR, band tới 8.0 và Academic/GT; mỗi người mở riêng. |
| Reading | Passage, MCQ, T/F/NG, Y/N/NG, matching, chọn nhiều đáp án, completion, sơ đồ; server chấm, giải thích và evidence sau nộp. |
| Listening | Bốn phần xã hội/học thuật, đối thoại và bẫy đính chính/phủ định; map/plan/diagram và completion; ElevenLabs khi cấu hình hoặc TTS trình duyệt ghi rõ nguồn. |
| Writing | Academic line/bar/pie/table/map/process/mixed charts, GT letter, Task 2; lưu nháp; mỗi task có tiêu chí và Task 2 trọng số gấp đôi. |
| Speaking | Ba parts, ghi âm WAV PCM mono 16 kHz, nghe lại, lưu riêng bằng GridFS; Whisper STT và OpenAI Audio chấm từ bản ghi; Azure âm học là lựa chọn bổ sung. |
| Thi thử thường | Reading 3 sections/40 câu/60 phút; Listening 4 parts/40 câu/30 phút; Writing 2 tasks/60 phút; Speaking 3 parts/khoảng 12 phút. Luôn mở riêng, deadline không reset qua reload. |
| Từ vựng | Nghĩa Việt, định nghĩa Anh, IPA, collocations, ví dụ, word family, lỗi thường gặp; flashcards FSRS với bốn mức Quên/Khó/Tốt/Dễ. |
| Theo dõi | Dashboard, điểm cá nhân, thời gian, lịch sử, sổ lỗi, đề xuất; kết quả Duo lưu mọi lượt thi và có API lịch sử phân trang theo owner. |
| Dữ liệu | Xuất JSON riêng; audio chỉ đọc được bởi owner. Duo không cho xóa lịch sử bằng endpoint chung vì cần giữ bằng chứng và kết quả bảo lưu. |

Hướng dẫn/đoạn mẫu cho bài advanced được hiển thị dưới mục thu gọn ở **Practice lesson band 7.5–8.0**. Exam và đánh giá Duo không hiển thị hướng dẫn đó. Các lượt làm lại cùng form không được coi là bằng chứng năng lực độc lập mới.

## Ngân hàng học liệu — fresh-20261011-v3

| Kỹ năng | Bài luyện | Đề mô phỏng |
| --- | ---: | ---: |
| Reading | 66 | 18 |
| Listening | 72 | 30 |
| Writing | 252 | 54 |
| Speaking | 252 (84 mỗi Part) | 54 |
| Grammar | 168 | 0 |
| Tổng | **810** | **156** |

Bộ hiện hành có **648 mục từ và 480 câu placement**, mức luyện 3.0–8.0. Bản v3 giữ nguyên mọi học liệu v2, thêm 540 bài luyện, 104 đề mô phỏng, 432 mục từ và 320 câu đầu vào; không reset bài làm hoặc hành trình. Nguồn Reading/Listening, tình huống Writing/Speaking, số liệu biểu đồ và mục từ được viết mới. Đề mô phỏng dùng nguồn riêng với bài luyện. Reading có đủ các dạng câu hỏi, Listening có đủ bốn Parts, Writing có bảy dạng biểu đồ/sơ đồ/bản đồ, GT letters và sáu nhóm Task 2.

`npm run audit:content`, `npm run audit:fresh` và `npm run audit:references` kiểm tra cấu trúc, evidence, đáp án qua bộ chấm thật, giới hạn từ, độ phủ, khối lượng đề, trùng nguồn và số liệu hình ảnh so với toàn bộ ngân hàng trước. Band/difficulty vẫn là ước lượng AI, `quality: ai-unreviewed`; kiểm tra tự động không thay cho duyệt bởi giám khảo.

Yêu cầu reset chỉ giữ hai tài khoản được thực hiện bằng [công cụ reset riêng](docs/bank-reset.md), sao lưu BSON/EJSON trước khi xóa dữ liệu IELTS. Startup/seed thường không xóa dữ liệu và từ chối ngân hàng cũ để tránh trộn hai bộ. Các tệp bộ cũ chỉ phục vụ kiểm thử hồi quy và so sánh lịch sử, không nằm trong seed đang dùng. `audit:expansion`/`audit:band8` là kiểm tra lịch sử của bộ cũ.

Sau khi hoàn thành placement, bài luyện hoặc đề, có thể xem đầy đủ câu trả lời, đáp án đúng, biến thể, giải thích và dẫn chứng; có lọc câu sai/bỏ trống và mở lại từ lịch sử. Writing/Speaking có bài mẫu minh họa cho mọi Task/Part, chỉ hiện sau nộp. Kho mẫu gồm **774 Tasks/Parts và 1.656 câu trả lời phỏng vấn**; không cần API key để xem mẫu. [Cập nhật đề và đáp án](docs/exam-upgrade.md) giữ tài khoản, tiến độ và nội dung riêng của bộ fresh.

## AI và điểm luyện tập

Mọi band là **ước lượng luyện tập, không phải điểm IELTS chính thức**. Reading/Listening chỉ dùng bảng tham khảo khi đủ form 40 câu; bài ngắn hiển thị raw score/evidence. Overall cần đủ bốn kỹ năng hợp lệ và dùng ngưỡng làm tròn .25/.75.

Thiếu OpenAI: Writing/Speaking lưu bài, metrics/checklist và band `null`. Transcript không đủ để đo phát âm. Với WAV PCM 16 kHz/16-bit/mono, `SPEAKING_AUDIO_MODEL=gpt-audio` nghe bản ghi, yêu cầu dẫn chứng có mốc thời gian cho độ trôi chảy và phát âm, dẫn chứng nguyên văn cho ngữ pháp/từ vựng. Thiếu lời nói, dưới 10 giây hoặc thiếu tiêu chí thì không tạo band toàn kỹ năng. Azure scores 0–100 không quy đổi trực tiếp thành band. Kết quả nâng band tiếp tục chờ nếu thiếu chấm AI/bằng chứng âm học; `POST /api/attempts/:id/regrade` chấm lại từ bài/bản ghi đã lưu của chính người đó. Lỗi provider giữ dữ liệu và trả lỗi để thử lại. Tests dùng transport/fixtures kiểm soát không chứng minh đã gọi nhà cung cấp live.

TTS trình duyệt là giọng máy tự luyện, không phải ElevenLabs hay accent đã kiểm định. Exam ẩn transcript/hints và chỉ cấp nguồn nghe một lần; đây là mô phỏng tự học, không phải thi có giám sát hay chống gian lận tuyệt đối.

## Cấu hình server

Không commit credentials hoặc dùng `VITE_*` cho secrets. `.env.example` có giá trị credentials trống; tệp riêng/kho secrets mới giữ giá trị thực.

| Biến | Mục đích |
| --- | --- |
| `MONGODB_URI` | URI MongoDB server thật; không in URI có credentials. |
| `DUO_CREDENTIALS_FILE` / `DUO_ACCOUNTS_JSON` | Một nguồn cấu hình riêng, đúng hai tài khoản, hash-only; xem `docs/duo-auth.md`. |
| `DUO_GATE_INTERVAL` | 5 hoặc 10, mặc định 5. |
| `DUO_SESSIONS_PER_BAND`, `DUO_SESSIONS_BY_BAND` | Mặc định 20 buổi; override số buổi theo band bằng JSON server-owned. |
| `DUO_PASS_PERCENT`, `DUO_STRICT_RETAKE_MODE` | Mặc định 70 và false; không nhận ngưỡng từ client. |
| `IELTS_OPENAI_API_KEY` | OpenAI Writing/Speaking/content/STT; `OPENAI_API_KEY` là alias local. |
| `CONTENT_MODEL`, `EXTRACTOR_MODEL`, `SCORING_MODEL`, `TRANSCRIPTION_MODEL`, `SPEAKING_AUDIO_MODEL` | Models server; bản cài đích dùng gpt-4o, whisper-1 và gpt-audio. |
| `ELEVENLABS_API_KEY`, ba biến `ELEVENLABS_VOICE_*`, `ELEVENLABS_MODEL` | TTS nhiều nhân vật bằng voice IDs thực; mặc định model eleven_v3. |
| `IELTS_AZURE_SPEECH_KEY`, `IELTS_AZURE_SPEECH_REGION` | Phân tích âm học; aliases local Azure được hỗ trợ. |
| `APP_ORIGIN`, `TRUST_PROXY` | HTTPS origin chính xác và proxy tin cậy; bắt buộc origin khi production. |

Bản cài `sutonghanyu.vn` có cấu hình AI mã hóa AES-256-GCM, chỉ mở bằng hai hash scrypt riêng đang có trên server. Git chỉ giữ ciphertext; key được mở trong bộ nhớ backend, không gửi tới client hoặc đưa vào shell history. Key riêng trong env luôn được ưu tiên để thay key sau này. Updater xác minh mở cấu hình trước khi dừng app. Bản cài khác không có đúng thông tin riêng vẫn cần key của chính mình.

Duo là mặc định; production luôn dùng Duo. `DUO_ENABLED=false` chỉ dành cho kiểm tra hồi quy local của chế độ email/demo cũ, không cấu hình website production như vậy. Flags `/api/health` cho biết cấu hình provider, không xác minh kết nối/chất lượng live. Đích mạng gồm `api.openai.com`, `api.elevenlabs.io`, hostname speech theo region và hostname MongoDB đã cấu hình.

## Kiểm tra

```sh
npm run typecheck
npm run audit:content
npm run audit:fresh
npm run audit:references
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Build trước browser tests vì fixture Duo phục vụ React từ `dist`. Tests dùng MongoDB thật trong namespace riêng, Chromium desktop/mobile và hai cookie jars cho Duo; cleanup chỉ xóa database test. Không dùng thông tin thật của hai người trong tests. Kiểm tra provider bằng transport kiểm soát không được gọi là đã kiểm chứng provider live. Kết quả cụ thể nằm trong [docs/validation.md](docs/validation.md).

## Cloud và VPS

[docs/cloud-start.md](docs/cloud-start.md) mô tả setup/start lại cloud. Tiến trình đang chạy không tồn tại qua publish environment; cấu hình draft cần Review → Save → Publish. Localhost trong cloud không phải URL công khai.

VPS có nhiều project: `deploy/run-exam-update.sh` chọn cập nhật giữ dữ liệu cho bộ fresh; chỉ dùng reset với ngân hàng legacy đã được cho phép xóa. Các công cụ ghim commit/SHA256, build giới hạn tài nguyên và chỉ dừng app IELTS để sao lưu/cập nhật `ielts_ai`. MongoDB/proxy/host Nginx và cấu hình website khác được đối chiếu giữ nguyên. [Quy trình reset](docs/bank-reset.md) phân biệt việc kiểm tra cloud với áp dụng và xác minh trên VPS.

Production dùng Node hosting hoặc Dockerfile, HTTPS `APP_ORIGIN` và MongoDB được bảo vệ. Express phục vụ cả `dist` và API cùng một port; reverse proxy cung cấp TLS. Không tắt TLS/checksums để xử lý lỗi tải dependency. Xem [MongoDB](docs/mongodb.md) và [triển khai](deploy/README.md).
