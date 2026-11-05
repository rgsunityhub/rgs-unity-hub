# RGS UNITY HUB — REVOLUSI GAMING SPORT

Community hub responsive untuk RGS. Frontend dibuat dengan React + TypeScript + Vite; autentikasi, PostgreSQL, file storage, RLS, dan realtime menggunakan Supabase. Website statis dapat di-host di Vercel Hobby tanpa watermark.

> **Status:** project Supabase `stdxeimphibosmhkhzvr` sudah dibuat; schema database dan Edge Function login sudah diterapkan, dan konfigurasi lokal sudah disambungkan. Website sudah di-deploy ke [rgs-unity-hub.vercel.app](https://rgs-unity-hub.vercel.app), dan Site URL serta Redirect URL Supabase untuk domain tersebut sudah dikonfigurasi. Source tersimpan di repository GitHub private [rgsunityhub/rgs-unity-hub](https://github.com/rgsunityhub/rgs-unity-hub), yang terhubung ke project Vercel dengan auto-deploy dari branch `main`. Fitur yang belum tersedia dicatat di bagian [Cakupan saat ini](#cakupan-saat-ini), jadi ini bukan klaim bahwa semua fitur permintaan sudah selesai.

## Struktur project

```text
.
├── public/
│   └── rgs-logo.png                     # Logo yang diberikan pemilik
├── src/
│   ├── App.tsx                          # Login, navigasi, halaman aplikasi
│   ├── main.tsx
│   ├── styles.css                       # Tema responsive
│   ├── vite-env.d.ts
│   └── lib/
│       ├── supabase.ts                  # Client memakai publishable/anon key
│       └── types.ts
├── supabase/
│   ├── config.toml
│   ├── schema.sql                       # Tabel, trigger, RPC, RLS, buckets
│   └── functions/
│       └── login-with-nickname/
│           └── index.ts                 # Login nickname tanpa mengekspos email
├── .env.example
├── package.json
└── vite.config.ts
```

## Persyaratan

- Node.js 20.19+ atau 22.12+ (sesuai kebutuhan Vite 7).
- Akun Supabase dan GitHub.
- Akun Vercel untuk URL website publik.
- VS Code; terminal PowerShell tersedia di menu **Terminal → New Terminal**.

## Instalasi lokal

1. Buka folder project ini di VS Code.
2. Dari terminal project, jalankan:

   ```powershell
   npm install
   ```

   Untuk salinan baru, buat `.env.local` dari `.env.example` hanya jika file itu belum ada. Jangan menimpa `.env.local` yang sudah berisi konfigurasi.
3. Untuk workspace ini, `.env.local` sudah dikonfigurasi dengan URL dan **publishable key** Supabase. Jika menyiapkan salinan project di komputer lain, buat project di [Supabase](https://supabase.com/dashboard), lalu dari **Project Settings → API** salin Project URL dan publishable key (atau legacy anon key) ke `.env.local`:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
   ```

   Key publishable/anon memang digunakan di browser. Jangan pernah menaruh `service_role` key di file `VITE_*`, frontend, GitHub, atau Vercel client variables.

4. Schema `supabase/schema.sql` sudah dijalankan pada project yang terhubung di workspace ini. Untuk project Supabase baru, jalankan seluruh isi file itu satu kali di **SQL Editor**. Script membuat tabel, trigger validasi invite, bucket, RLS, role helper, dan menambahkan tabel chat ke Realtime.
5. Edge Function `login-with-nickname` sudah di-deploy ke project yang terhubung. Untuk deploy ulang atau menyiapkan project baru, install Supabase CLI jika belum tersedia, login, link project, lalu deploy fungsi. Project ref yang terhubung saat ini adalah `stdxeimphibosmhkhzvr`:

   ```powershell
   npx supabase login
   npx supabase link --project-ref stdxeimphibosmhkhzvr
   npx supabase functions deploy login-with-nickname --no-verify-jwt
   ```

   Untuk project baru, ganti ref dengan milik project tersebut. Fungsi memakai secret environment bawaan Supabase Edge Functions (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY`). Service-role key hanya digunakan server-side untuk mencari akun dan rate limit.
6. Untuk project yang terhubung, Site URL sudah disetel ke `http://localhost:5173` dan Redirect URLs untuk `localhost` serta `127.0.0.1` pada port `5173` dan `5174` sudah ditambahkan. Untuk project baru, atur Site URL dan Redirect URLs yang sesuai. Untuk production, tambahkan URL Vercel Anda setelah deploy.
7. Jalankan:

   ```powershell
   npm run dev
   ```

   Buka URL yang dicetak Vite (biasanya `http://localhost:5173`).

## Bootstrap akun OWNER dan invite code pertama

Tidak ada password bawaan atau owner yang ditanam di source. Buat invite bootstrap satu kali melalui **Supabase SQL Editor**:

```sql
insert into public.invite_codes (code, created_by, max_uses)
values ('RGS-BOOTSTRAP-GANTI-SEKARANG', null, 1);
```

Daftar melalui halaman website menggunakan kode tersebut, alamat email yang dapat diakses, nickname, dan password kuat. Setelah akun terdaftar, promosikan akun berdasarkan nickname di SQL Editor:

```sql
update public.profiles
set role = 'owner'
where lower(nickname) = lower('NICKNAME_OWNER_ANDA');
```

Pastikan tepat satu akun yang dimaksud ditemukan sebelum menjalankan `UPDATE`. Kemudian nonaktifkan invite bootstrap:

```sql
update public.invite_codes
set active = false
where code = 'RGS-BOOTSTRAP-GANTI-SEKARANG';
```

Ganti kode contoh dengan nilai unik, jangan gunakan ulang. SQL Editor berjalan dengan hak administratif; jangan memberi akses SQL Editor atau service-role key ke member. Signup langsung tanpa kode valid ditolak oleh trigger database meskipun seseorang memanggil Supabase Auth API tanpa UI.

## Login, role, dan invite

- Signup menerima nickname, email pemulihan, password, konfirmasi, dan invite code. Email diperlukan untuk recovery password yang aman.
- Database memvalidasi format nickname dan mengonsumsi invite secara atomik dalam trigger signup; kode nonaktif, kedaluwarsa, atau habis pakai gagal.
- Login menerima nickname dan password. Edge Function mencari akun di server, lalu menyerahkan verifikasi password ke Supabase Auth; respons kesalahan tidak membedakan akun tidak ditemukan dari password salah.
- Rate limit login dibatasi di database per hash alamat jaringan + nickname.
- Role default selalu `user`; metadata signup tidak dapat memilih role. Hanya owner dapat mengubah role member lain; perubahan role akun sendiri diblokir di UI dan database untuk mencegah owner terkunci dari aksesnya.
- Admin dapat membuat invite dan melihat daftar member. Owner dapat mengaktifkan/nonaktifkan kode. Owner adalah satu-satunya yang dapat mengubah role.
- Permintaan reset password pada halaman login menggunakan tautan recovery Supabase Auth yang dikirim ke email. Jangan minta atau menampilkan password lama.

## Backend dan permission

`supabase/schema.sql` membuat:

- `profiles`, `invite_codes`, `publications`, `files`.
- `chat_rooms`, `chat_room_members`, `chat_messages`.
- `notifications`, `password_reset_requests`, `auth_login_attempts`.
- RLS untuk memastikan profil dan publikasi privat hanya dapat diubah pemiliknya; chat privat mensyaratkan keanggotaan room.
- Bucket privat `member-files`; aturan Storage memeriksa metadata file sebelum membaca objek. Bucket `avatars` publik hanya untuk gambar profil.
- Supabase Realtime mencakup profil, publikasi, interaksi publikasi, file, invite, notifikasi, dan pesan chat agar halaman aktif memperbarui data tanpa reload. Indikator notifikasi di header/sidebar menghitung notifikasi belum dibaca milik akun aktif; tombol bel membuka halaman notifikasi dan avatar membuka profil.

Semua key project selain publishable/anon harus tetap berada di server. RLS adalah batas keamanan utama; menyembunyikan navigasi saja tidak dianggap otorisasi.

## Fitur yang tersambung

- Login nickname, signup wajib email/invite, recovery email Supabase.
- Feed publikasi teks publik, dashboard statistik dasar, filter/pencarian publikasi.
- Menu opsi publikasi di Beranda untuk menyalin tautan; pemilik publikasi dapat menghapus publikasinya sendiri sesuai kebijakan RLS.
- Profil sendiri (bio/avatar), daftar dan pencarian member.
- Upload/download/hapus file milik sendiri, ubah visibilitas Public/Private melalui badge pada daftar file, daftar file Public bersama yang bisa diunduh anggota, validasi MIME yang diizinkan serta batas 25 MB per file. File Private hanya terlihat oleh pemiliknya.
- File Storage berstatus Public otomatis muncul di bagian "File publik terbaru" pada Beranda dan Dashboard, tersinkron melalui Supabase Realtime; file Private tidak ditampilkan.
- Share video YouTube valid melalui YouTube privacy-enhanced embed dengan referrer/origin eksplisit di halaman YouTube, Beranda, dan aktivitas Dashboard; pemilik dapat mengubah visibilitas video Public/Private dan sediakan tautan fallback untuk membuka video di YouTube. Private video hanya ditampilkan pemiliknya. Tidak ada converter atau downloader.
- Chat room publik realtime; private room dibatasi oleh RLS `chat_room_members`.
- Buat invite code admin/owner, nonaktifkan kode oleh owner, notifikasi saat kode digunakan.

## Cakupan saat ini yang belum tersedia

Implementasi ini belum mencakup semua modul dalam spesifikasi awal. Belum tersedia: DM dan grup chat UI/manajemen anggota room, moderasi/laporan, likes dan komentar yang tersimpan, daftar online-presence, owner approval untuk reset password, dashboard untuk meninjau reset request, penghapusan/nonaktifkan akun, role management UI, folder/rename/preview/sorting file, notifikasi lengkap untuk semua kejadian, statistik storage teragregasi owner, email SMTP kustom, dan alur publikasi otomatis untuk file upload. Jangan gunakan UI ini sebagai pengganti kebijakan moderasi atau sistem produksi sebelum kebutuhan tersebut dibangun dan diuji.

File di bucket tetap privat kecuali metadata file menyatakan `public`; owner juga tidak diberi akses baca otomatis ke file pribadi anggota. Ini sengaja agar privasi tidak dilewati oleh role administratif.

## Deploy gratis ke Vercel

Deployment production: [https://rgs-unity-hub.vercel.app](https://rgs-unity-hub.vercel.app). Repository GitHub private [rgsunityhub/rgs-unity-hub](https://github.com/rgsunityhub/rgs-unity-hub) sudah terhubung ke project Vercel `rgs-unity-hub`; Vercel GitHub App hanya diberi akses ke repository tersebut. Setiap push ke branch `main` memicu build dan deployment production otomatis. `.env.local` tidak ikut commit (`.gitignore` mengecualikannya).

Konfigurasi Vercel yang digunakan:

1. Framework preset **Vite**, build command `npm run build`, output directory `dist` (ditetapkan juga di `vercel.json`).
2. **Project Settings → Environment Variables** berisi `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` untuk Production, Preview, dan Development. Publishable/anon key memang digunakan di browser; jangan pernah menambahkan `service_role` key sebagai variabel `VITE_*`.
3. Site URL Supabase dan Redirect URLs sudah diatur untuk domain production ini.

Untuk menyiapkan ulang koneksi Git pada project baru:

1. Buat repository GitHub, push source project, dan pastikan `.env.local` tidak pernah ikut commit.
2. Di [Vercel](https://vercel.com), import repository tersebut lalu pilih **Vite** sebagai framework.
3. Tambahkan environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy dan masukkan URL publik yang diberikan Vercel ke Supabase **Authentication → URL Configuration** sebagai Site URL dan Redirect URL.
7. Pastikan fungsi `login-with-nickname` sudah dideploy ke project Supabase yang sama.

Deploy statis Vite tidak memerlukan Vercel Function. GitHub menyimpan source; Supabase menyediakan backend. Jangan menganggap URL publik aktif sebelum konfigurasi Supabase dan deploy Vercel selesai.

## Batas layanan gratis

Kuota dapat berubah dan penggunaan berlebih dapat membatasi layanan atau menimbulkan biaya. Periksa dashboard/halaman harga sebelum mengundang banyak member. Pada halaman resmi yang diperiksa **6 November 2026**:

- [Supabase Pricing](https://supabase.com/pricing): Free mencantumkan 500 MB database/project, 1 GB file storage, 5 GB egress + 5 GB cached egress, 50.000 MAU; project gratis dapat dipause setelah satu minggu tidak aktif dan dibatasi dua project aktif. Batas aktual tiap produk/fitur dan kebijakan pause bisa berubah.
- [Vercel Pricing](https://vercel.com/pricing): Hobby $0 untuk penggunaan personal/non-komersial sesuai ketentuan Hobby; halaman mencantumkan 100 GB transfer bulanan dan 1 juta invokasi fungsi per bulan pada Hobby. Quota dapat berubah dan fitur usage/billing berbeda menurut produk. Website ini menggunakan output statis.
- Tidak ada layanan “unlimited gratis”. File video tidak di-host di sini; YouTube ditampilkan lewat embed resmi untuk menghemat storage/bandwidth.

## Troubleshooting

- **Aplikasi menampilkan konfigurasi Supabase:** pastikan `.env.local` berada di root, nama variabel tepat, lalu stop dan jalankan ulang `npm run dev`.
- **Invite tidak valid:** pastikan schema sudah dijalankan, kode masih aktif, belum melewati `max_uses`, dan penulisan kode benar.
- **Signup gagal / nickname bentrok:** nickname 3–24 karakter dan unik tanpa membedakan huruf besar-kecil. Lihat detail error Supabase Auth/SQL logs.
- **Email belum terverifikasi:** selesaikan verifikasi; pastikan SMTP/Auth email dan Redirect URLs Supabase dikonfigurasi. Untuk uji lokal, gunakan mode email confirmation sesuai pengaturan project.
- **Login nickname tidak bekerja:** pastikan Edge Function ter-deploy dengan nama `login-with-nickname`, project ref benar, dan function logs tidak menunjukkan konfigurasi env/error.
- **Upload ditolak:** periksa batas 25 MB di UI dan bucket, MIME type, serta Storage policies/schema sudah diterapkan.
- **Chat kosong atau tidak realtime:** cek tabel `chat_messages` masuk publication `supabase_realtime`, Realtime aktif, dan user authenticated.
- **Build lokal:** `npm run build`. Untuk melihat hasil production lokal: `npm run preview`.

## Sumber layanan

- [Supabase Docs](https://supabase.com/docs)
- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Vercel Vite deployment](https://vercel.com/docs/frameworks/frontend/vite)
