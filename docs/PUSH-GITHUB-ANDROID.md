# Đưa source Abyss Adventure lên GitHub bằng Android

File source: Abyss-Adventure-1.0.1-GitHub-Source.zip. Giải nén sẽ có một thư mục abyss-adventure chứa README.md, package.json, apps, packages, public, android-preview, scripts và tests.

## 1. Tải và chuẩn bị

1. Tải ZIP vào Download. Không đổi tên file để lệnh bên dưới chạy đúng.
2. Cài Termux từ https://f-droid.org/packages/com.termux/ hoặc trang chính thức https://github.com/termux/termux-app/releases.
3. Mở Termux, chạy từng dòng:

```sh
pkg update
pkg install git gh unzip -y
termux-setup-storage
```

Cho phép Termux truy cập bộ nhớ khi Android hỏi.

## 2. Giải nén trong bộ nhớ riêng của Termux

```sh
mkdir -p ~/projects
unzip ~/storage/downloads/Abyss-Adventure-1.0.1-GitHub-Source.zip -d ~/projects
cd ~/projects/abyss-adventure
ls
```

Nếu tên file tải về có (1), đổi lại đúng tên bằng trình quản lý file hoặc sửa tên trong lệnh unzip. Nếu đã có thư mục ~/projects/abyss-adventure từ trước, đổi tên thư mục cũ để tránh ghi đè.

## 3. Đăng nhập GitHub

```sh
gh auth login --hostname github.com --git-protocol https --web
```

Chọn đăng nhập bằng trình duyệt, ghi nhớ mã gh hiển thị, mở https://github.com/login/device trên Chrome, nhập mã và Authorize GitHub CLI. Nếu hỏi Authenticate Git with your GitHub credentials, chọn Yes.

```sh
gh auth status
```

Phải thấy tài khoản GitHub đang đăng nhập. Không gửi mật khẩu hay mã truy cập vào chat.

## 4. Ghi commit đầu tiên

Thay YOUR_NAME bằng tên anh muốn hiện trên commit. Thay YOUR_EMAIL bằng email GitHub hoặc email noreply trong GitHub Settings → Emails.

```sh
git config --global user.name "YOUR_NAME"
git config --global user.email "YOUR_EMAIL"
git init -b main
git add .
git status --short
git commit -m "Initial release: Abyss Adventure 1.0.1"
```

.gitignore đã loại node_modules, dist, APK, ZIP và khóa ký. Không chép khóa ký vào thư mục source.

## 5A. Tạo repository mới và push (khuyên dùng)

Chỉ chạy nếu anh chưa có repo này. Repo mặc định Private để giữ code/art của game, người chơi vẫn có thể nhận APK riêng.

```sh
gh repo create abyss-adventure --private --source=. --remote=origin --push
```

Lệnh tạo repo trong tài khoản anh đang đăng nhập và đẩy nhánh main. Nếu anh muốn source công khai, thay --private bằng --public trước khi chạy.

## 5B. Nếu đã có repository GitHub

Không chạy 5A. Thay YOUR_USERNAME trong URL. Nếu repo rỗng:

```sh
git remote add origin https://github.com/YOUR_USERNAME/abyss-adventure.git
git push -u origin main
```

Nếu repo đã có nội dung, không force push. Dùng thư mục riêng, clone repo rồi chép source vào đó:

```sh
cd ~/projects
git clone https://github.com/YOUR_USERNAME/abyss-adventure.git abyss-adventure-github
mkdir -p ~/projects/source-import
unzip ~/storage/downloads/Abyss-Adventure-1.0.1-GitHub-Source.zip -d ~/projects/source-import
cp -a ~/projects/source-import/abyss-adventure/. ~/projects/abyss-adventure-github/
cd ~/projects/abyss-adventure-github
git switch -c import-1.0.1
git add .
git commit -m "Import Abyss Adventure 1.0.1 source"
git push -u origin import-1.0.1
```

Trên GitHub mở Pull request từ import-1.0.1 vào nhánh chính và kiểm tra trước khi Merge.

## 6. Kiểm tra đã push thành công

```sh
git status
git remote -v
gh repo view --web
```

Git status cần hiện working tree clean; trên GitHub phải có apps/game/main.ts, packages/content/data.json, public/art/currency/summon-ticket.png, README.md và docs/PUSH-GITHUB-ANDROID.md. Không chỉ có 1 file ZIP.

## 7. Cập nhật code những lần sau

Chỉnh đúng file trong ~/projects/abyss-adventure (hoặc repo đã clone), rồi:

```sh
git add .
git commit -m "Describe the change"
git push
```

## 8. Build/kiểm tra web (tùy chọn, không cần để push)

Cần Node 22+. Trên Termux:

```sh
pkg install nodejs-lts -y
node --version
npm ci
npm test
npm run build
npm run dev
```

Mở Chrome tới http://127.0.0.1:5173. Nếu thiếu dependency native trên Android, dùng Node 22 trong môi trường Linux thay vì ép cài bỏ qua lỗi. Hướng dẫn native APK và yêu cầu SDK nằm trong README. Source ZIP không bao gồm khóa ký nên không thể tự ký APK cập nhật tương thích chỉ bằng ZIP này.

## 9. Chia sẻ APK

GitHub repository Private không cho người chơi chưa được mời tải Release. Anh có thể gửi APK trực tiếp, hoặc tạo repo Public chỉ dành cho APK. Mở repo phát hành → Releases → Draft a new release → tag v1.0.1 → đính kèm Abyss-Adventure-1.0.1.apk → Publish release. Người chơi tải APK từ Assets, không tải Source code ZIP để cài game.

## Nguồn tham khảo

- https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github
- https://cli.github.com/manual/gh_auth_login
- https://cli.github.com/manual/gh_repo_create
- https://github.com/termux/termux-app#installation
