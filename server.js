require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const mysql = require('mysql2/promise');
const multer = require('multer');

const app = express();
const port = 3000;

// Konfigurasi EJS & File Statis
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (/^image\//.test(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diizinkan')); 
        }
    }
});

// Middleware untuk membaca data dari formulir (POST request)
app.use(express.urlencoded({ extended: true }));

// Konfigurasi Session untuk Fitur Login
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true
}));

// --- KONFIGURASI DATABASE MYSQL ---
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'web_desa',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function verifyDatabaseConnection() {
    try {
        const connection = await db.getConnection();
        await connection.ping();
        await connection.query(`
            CREATE TABLE IF NOT EXISTS laporan (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nama VARCHAR(100),
                tipe VARCHAR(50),
                isi TEXT,
                status VARCHAR(50),
                tanggal VARCHAR(100),
                foto VARCHAR(255)
            )
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS surat_pengantar (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nama VARCHAR(100),
                nik VARCHAR(50),
                keperluan VARCHAR(100),
                alamat TEXT,
                no_hp VARCHAR(50),
                catatan TEXT,
                alasan_penolakan TEXT,
                status VARCHAR(50),
                tanggal VARCHAR(100)
            )
        `);
        connection.release();
        console.log(`Database MySQL terhubung: ${process.env.DB_NAME || 'web_desa'}`);
    } catch (err) {
        console.error('Gagal terhubung ke database MySQL:', err.message);
        process.exit(1);
    }
}

verifyDatabaseConnection();

// --- DATABASE SIMULASI (Data Asli Anda + Data Fitur Baru) ---
// Bagian ini tetap untuk info statis desa
const infoDesa = {
    nama: "Desa Sukamakmur",
    kepalaDesa: "Bpk. Budi Santoso",
    populasi: "3.500",
    wilayah: {
        deskripsi: "Desa Sukamakmur terletak di dataran rendah yang subur dengan lanskap sawah, perumahan, dan area publik yang terawat.",
        dusun: ["Dusun Karang", "Dusun Mulyo", "Dusun Makmur"]
    },
    visi: "Mewujudkan Desa Sukamakmur yang Mandiri, Sejahtera, dan Berbudaya melalui Tata Kelola Pemerintahan yang Transparan dan Inovatif.",
    misi: [
        "Meningkatkan kualitas pelayanan publik berbasis digital untuk efisiensi birokrasi.",
        "Membangun infrastruktur desa yang merata dan berkelanjutan.",
        "Mendorong kemandirian ekonomi masyarakat melalui pemberdayaan UMKM dan BUMDes.",
        "Meningkatkan taraf hidup warga melalui program kesehatan dan pendidikan yang berkualitas.",
        "Menjaga kerukunan sosial dan melestarikan nilai-nilai budaya lokal."
    ],
    layanan: [
        {
            icon: "📄",
            nama: "Surat Pengantar",
            slug: "surat-pengantar",
            desc: "Layanan pembuatan pengantar SKCK, KTP, dan KK.",
            detail: {
                headline: "Pengajuan Surat Pengantar Lebih Cepat",
                content: "Daftar kebutuhan administrasi penduduk desa seperti SKCK, KTP, KK, dan surat keterangan lainnya dalam satu proses digital yang jelas.",
                langkah: [
                    "Isi formulir permohonan di kantor desa atau melalui portal digital.",
                    "Serahkan dokumen pendukung seperti fotokopi KTP, KK, dan surat lama jika diperlukan.",
                    "Tunggu verifikasi petugas desa, lalu ambil surat pada jadwal yang ditentukan."
                ],
                syarat: [
                    "Fotokopi KTP",
                    "Fotokopi KK",
                    "Surat kuasa (jika diwakili)",
                    "Data kelengkapan sesuai jenis surat"
                ]
            }
        },
        {
            icon: "🚨",
            nama: "Kontak Darurat",
            slug: "kontak-darurat",
            desc: "Hubungi petugas desa dalam keadaan darurat.",
            detail: {
                headline: "Kontak Darurat Desa Sukamakmur",
                content: "Untuk kondisi darurat, segera hubungi petugas desa atau tenaga kesehatan melalui nomor yang tersedia. Pastikan Anda menjelaskan situasi dengan jelas agar respons cepat dapat diberikan.",
                langkah: [
                    "Hubungi nomor darurat desa melalui telepon atau WhatsApp.",
                    "Sampaikan nama, alamat, dan jenis kejadian darurat dengan jelas.",
                    "Tunggu konfirmasi dari petugas desa dan ikuti instruksi keselamatan."
                ],
                syarat: [
                    "Pastikan nomor telepon sudah dapat dihubungi.",
                    "Sediakan informasi lokasi terperinci.",
                    "Simpan nomor darurat desa di kontak ponsel Anda."
                ],
                kontak: [
                    { jenis: "Petugas Desa", nilai: "081234567890" },
                    { jenis: "Petugas Kesehatan", nilai: "081298765432" },
                    { jenis: "Pengaduan Darurat", nilai: "085712345678" }
                ]
            }
        },
        {
            icon: "�👥",
            nama: "Data Kependudukan",
            slug: "data-kependudukan",
            desc: "Pelaporan mutasi, kelahiran, dan kematian warga.",
            detail: {
                headline: "Layanan Administrasi Kependudukan",
                content: "Bantu warga Desa Sukamakmur memperbarui data kependudukan secara mudah, termasuk mutasi, kelahiran, kematian, dan perubahan identitas.",
                langkah: [
                    "Laporkan perubahan data keluarga ke kantor desa.",
                    "Lengkapi dokumen pendukung sesuai jenis pelaporan.",
                    "Petugas desa memproses dan mengeluarkan surat perubahan data resmi."
                ],
                syarat: [
                    "Surat keterangan RT/RW",
                    "Kartu keluarga terbaru",
                    "Akta kelahiran/akta kematian jika dibutuhkan",
                    "Dokumen identitas pendukung"
                ]
            }
        },
        {
            icon: "🚑",
            nama: "Layanan Kesehatan",
            slug: "layanan-kesehatan",
            desc: "Informasi jadwal Posyandu dan penggunaan Ambulan Desa.",
            detail: {
                headline: "Program Kesehatan untuk Masyarakat",
                content: "Akses informasi Posyandu, imunisasi, pelayanan kesehatan keluarga, dan rujukan ambulans desa secara transparan dan mudah.",
                langkah: [
                    "Cek jadwal Posyandu dan layanan kesehatan di papan pengumuman atau portal desa.",
                    "Datang ke Posyandu dengan membawa kartu keluarga dan catatan kesehatan.",
                    "Gunakan layanan ambulans desa ketika diperlukan dengan koordinasi petugas kesehatan desa."
                ],
                syarat: [
                    "Kartu Keluarga",
                    "KTP/Kartu Identitas",
                    "Catatan Imunisasi (jika ada)",
                    "Surat rujukan dari petugas kesehatan bila diperlukan"
                ]
            }
        },
        {
            icon: "🌾",
            nama: "Bantuan Sosial",
            slug: "bantuan-sosial",
            desc: "Informasi penyaluran BLT dan program bantuan lainnya.",
            detail: {
                headline: "Informasi Bantuan Sosial Desa",
                content: "Dapatkan update program bantuan sosial, kriteria penerima, serta cara memperoleh bantuan BLT, sembako, dan dukungan sosial lainnya.",
                langkah: [
                    "Periksa pengumuman bantuan sosial di kantor desa atau situs resmi desa.",
                    "Siapkan dokumen kelayakan sesuai syarat program.",
                    "Ajukan permohonan bantuan dan tunggu verifikasi oleh petugas desa."
                ],
                syarat: [
                    "KTP dan KK",
                    "Surat Keterangan Tidak Mampu (jika diperlukan)",
                    "Dokumen pendukung program bantuan",
                    "Formulir pendaftaran bantuan"
                ]
            }
        }
    ],
    pemerintahan: {
        desa: {
            judul: "Pemerintah Desa",
            deskripsi: "Pemerintahan Desa Sukamakmur bertugas membangun pelayanan publik yang ramah dan transparan, mengelola anggaran desa, serta memberdayakan warga melalui program pembangunan berkelanjutan.",
            struktur: [
                "Kepala Desa",
                "Sekretaris Desa",
                "Kasi Pemerintahan",
                "Kasi Kesejahteraan",
                "Kasi Pelayanan"
            ],
            tugas: [
                "Menyusun dan mengelola rencana pembangunan desa.",
                "Memberikan pelayanan administrasi publik kepada warga.",
                "Menjaga keamanan serta ketertiban di lingkungan desa.",
                "Melaksanakan program pemberdayaan masyarakat.",
                "Mengelola dana desa secara akuntabel dan transparan."
            ]
        },
        bpd: {
            judul: "Badan Permusyawaratan Desa (BPD)",
            deskripsi: "BPD berfungsi sebagai lembaga legislatif desa yang mengawasi jalannya pemerintahan desa, menyerap aspirasi warga, dan memberikan masukan dalam perencanaan pembangunan.",
            tugas: [
                "Mengawasi pelaksanaan peraturan desa dan kebijakan desa.",
                "Membahas dan menyepakati rencana pembangunan desa.",
                "Menampung aspirasi masyarakat dan menjadikannya usulan prioritas.",
                "Melakukan fungsi kontrol terhadap penggunaan anggaran desa."
            ]
        },
        lpmd: {
            judul: "Lembaga Pemberdayaan Masyarakat Desa (LPMD)",
            deskripsi: "LPMD berperan mendorong partisipasi masyarakat dalam pembangunan desa, membantu penciptaan ekonomi lokal, dan memperkuat kapasitas organisasi warga.",
            tugas: [
                "Menyusun program pemberdayaan masyarakat desa.",
                "Memfasilitasi pelatihan dan pelaksanaan kegiatan ekonomi lokal.",
                "Menjalin koordinasi dengan kelompok warga dan pelaku UMKM desa.",
                "Mendukung penguatan kelembagaan desa yang inklusif."
            ]
        }
    }
};

// Tambahkan ini agar variabel 'desa' otomatis tersedia di SEMUA file .ejs
app.locals.desa = infoDesa;

// --- MIDDLEWARE KEAMANAN ---
function cekAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.redirect('/login?error=Akses Khusus Admin!');
    }
}

function cekUser(req, res, next) {
    if (req.session.user && req.session.user.role === 'user') {
        next();
    } else {
        res.redirect('/login?error=Silahkan Login Terlebih Dahulu!');
    }
}

// --- RUTE UTAMA (PUBLIC) ---
app.get('/', async (req, res) => {
    try {
        const [berita] = await db.query('SELECT * FROM berita ORDER BY id DESC LIMIT 3');
        res.render('index', { desa: infoDesa, berita, user: req.session.user });
    } catch (err) {
        res.status(500).send("Database Error");
    }
});

app.get('/profil', (req, res) => {
    res.redirect('/profil/visi-misi');
});

app.get('/profil/visi-misi', (req, res) => {
    res.render('profil', { desa: infoDesa, user: req.session.user });
});

app.get('/profil/wilayah-desa', (req, res) => {
    res.render('wilayah-desa', { desa: infoDesa, user: req.session.user });
});

app.get('/pemerintahan/desa', (req, res) => {
    res.render('pemerintahan-desa', { desa: infoDesa, user: req.session.user });
});

app.get('/pemerintahan/bpd', (req, res) => {
    res.render('pemerintahan-bpd', { desa: infoDesa, user: req.session.user });
});

app.get('/pemerintahan/lpmd', (req, res) => {
    res.render('pemerintahan-lpmd', { desa: infoDesa, user: req.session.user });
});

app.get('/layanan/pengaduan', (req, res) => {
    res.render('pengaduan', { desa: infoDesa, user: req.session.user });
});

app.post('/layanan/surat-pengantar/ajukan', cekUser, async (req, res) => {
    const { nama, nik, keperluan, alamat, noHp, catatan } = req.body;
    const tanggal = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    try {
        await db.query(
            'INSERT INTO surat_pengantar (nama, nik, keperluan, alamat, no_hp, catatan, status, tanggal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [nama || req.session.user.username, nik, keperluan, alamat, noHp, catatan, 'Menunggu', tanggal]
        );
        res.redirect('/layanan/surat-pengantar?success=1');
    } catch (err) {
        res.redirect('/layanan/surat-pengantar?error=1');
    }
});

app.post('/layanan/:slug/ajukan', cekUser, async (req, res) => {
    const layanan = infoDesa.layanan.find(item => item.slug === req.params.slug);
    if (!layanan || req.params.slug !== 'surat-pengantar') {
        return res.status(404).send('Rute tidak ditemukan');
    }

    const { nama, nik, keperluan, alamat, noHp, catatan } = req.body;
    const tanggal = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    try {
        await db.query(
            'INSERT INTO surat_pengantar (nama, nik, keperluan, alamat, no_hp, catatan, status, tanggal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [nama || req.session.user.username, nik, keperluan, alamat, noHp, catatan, 'Menunggu', tanggal]
        );
        res.redirect(`/layanan/${req.params.slug}?success=1`);
    } catch (err) {
        res.redirect(`/layanan/${req.params.slug}?error=1`);
    }
});

app.get('/layanan/:slug', (req, res) => {
    const layanan = infoDesa.layanan.find(item => item.slug === req.params.slug);
    if (!layanan) {
        return res.status(404).send('Layanan tidak ditemukan');
    }
    const success = req.query.success === '1';
    const error = req.query.error === '1';
    res.render('layanan-detail', { desa: infoDesa, user: req.session.user, layanan, success, error });
});

app.get('/transparansi', async (req, res) => {
    try {
        const [rincian] = await db.query('SELECT * FROM anggaran WHERE tahun = 2024');
        res.render('transparansi', { desa: infoDesa, anggaran: { rincian }, user: req.session.user });
    } catch (err) {
        res.status(500).send("Database Error");
    }
});

app.get('/statistik', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM statistik LIMIT 1');
        const statistik = rows[0] || {};
        res.render('statistik', { desa: infoDesa, statistik, user: req.session.user });
    } catch (err) {
        res.status(500).send("Database Error");
    }
});

// --- RUTE LOGIN & LOGOUT ---
app.get('/login', (req, res) => {
    res.render('login', { error: req.query.error, user: req.session.user });
});

app.get('/register', (req, res) => {
    res.render('register', { error: req.query.error, user: req.session.user });
});

app.post('/register', async (req, res) => {
    const { username, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
        return res.redirect('/register?error=Password dan konfirmasi tidak cocok!');
    }

    try {
        const [exist] = await db.query('SELECT id FROM users WHERE username = ?', [username]);
        if (exist.length > 0) {
            return res.redirect('/register?error=Username sudah terdaftar!');
        }

        await db.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, password, 'user']);
        res.redirect('/login?error=Registrasi berhasil! Silahkan login.');
    } catch (err) {
        res.redirect('/register?error=Terjadi kesalahan sistem.');
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        const [rows] = await db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password]);
        
        if (rows.length > 0) {
            const user = rows[0];
            req.session.user = { username: user.username, role: user.role };
            if (user.role === 'admin') {
                res.redirect('/admin');
            } else {
                res.redirect('/user');
            }
        } else {
            res.redirect('/login?error=Username atau Password Salah!');
        }
    } catch (err) {
        res.redirect('/login?error=Terjadi kesalahan database.');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- RUTE KHUSUS ADMIN ---
app.get('/admin', cekAdmin, async (req, res) => {
    try {
        const [berita] = await db.query('SELECT * FROM berita ORDER BY id DESC');
        const [laporan] = await db.query('SELECT * FROM laporan ORDER BY id DESC');
        const [suratPengantar] = await db.query('SELECT * FROM surat_pengantar ORDER BY id DESC');
        res.render('admin', { desa: infoDesa, user: req.session.user, berita, laporanWarga: laporan, suratPengantar });
    } catch (err) {
        res.status(500).send("Database Error");
    }
});

app.post('/admin/surat-pengantar/:id/status', cekAdmin, async (req, res) => {
    const { id } = req.params;
    const { action, alasanPenolakan } = req.body;
    let status = 'Menunggu';

    if (action === 'konfirmasi') {
        status = 'Disetujui';
    } else if (action === 'tolak') {
        status = 'Ditolak';
    } else {
        return res.redirect('/admin');
    }

    try {
        const [rows] = await db.query('SELECT status, alasan_penolakan FROM surat_pengantar WHERE id = ?', [id]);
        if (rows.length === 0) {
            return res.redirect('/admin');
        }

        const surat = rows[0];
        if (surat.status === 'Ditolak' && surat.alasan_penolakan) {
            return res.redirect('/admin');
        }

        if (action === 'tolak') {
            await db.query('UPDATE surat_pengantar SET status = ?, alasan_penolakan = ? WHERE id = ?', [status, alasanPenolakan || null, id]);
        } else {
            await db.query('UPDATE surat_pengantar SET status = ?, alasan_penolakan = NULL WHERE id = ?', [status, id]);
        }
        res.redirect('/admin');
    } catch (err) {
        res.redirect('/admin');
    }
});

app.post('/admin/tambah-berita', cekAdmin, upload.single('fotoBerita'), async (req, res) => {
    const { judul, ringkasan } = req.body;
    const foto = req.file ? `uploads/${req.file.filename}` : null;
    const tanggalHariIni = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    
    try {
        if (foto) {
            await db.query('INSERT INTO berita (judul, tanggal, ringkasan, foto) VALUES (?, ?, ?, ?)', [judul, tanggalHariIni, ringkasan, foto]);
        } else {
            await db.query('INSERT INTO berita (judul, tanggal, ringkasan) VALUES (?, ?, ?)', [judul, tanggalHariIni, ringkasan]);
        }
        res.redirect('/admin');
    } catch (err) {
        if (foto && err.code === 'ER_BAD_FIELD_ERROR') {
            try {
                await db.query('INSERT INTO berita (judul, tanggal, ringkasan) VALUES (?, ?, ?)', [judul, tanggalHariIni, ringkasan]);
                return res.redirect('/admin');
            } catch (innerErr) {}
        }
        res.redirect('/admin?error=Gagal menambah berita');
    }
});

app.get('/admin/edit-berita/:id', cekAdmin, async (req, res) => {
    const id = req.params.id;
    try {
        const [rows] = await db.query('SELECT * FROM berita WHERE id = ?', [id]);
        if (rows.length > 0) {
            res.render('edit-berita', { user: req.session.user, berita: rows[0], id });
        } else {
            res.redirect('/admin');
        }
    } catch (err) {
        res.redirect('/admin');
    }
});

app.post('/admin/edit-berita/:id', cekAdmin, upload.single('fotoBerita'), async (req, res) => {
    const id = req.params.id;
    const { judul, ringkasan } = req.body;
    const foto = req.file ? `uploads/${req.file.filename}` : null;
    try {
        if (foto) {
            await db.query('UPDATE berita SET judul = ?, ringkasan = ?, foto = ? WHERE id = ?', [judul, ringkasan, foto, id]);
        } else {
            await db.query('UPDATE berita SET judul = ?, ringkasan = ? WHERE id = ?', [judul, ringkasan, id]);
        }
        res.redirect('/admin');
    } catch (err) {
        if (foto && err.code === 'ER_BAD_FIELD_ERROR') {
            try {
                await db.query('UPDATE berita SET judul = ?, ringkasan = ? WHERE id = ?', [judul, ringkasan, id]);
                return res.redirect('/admin');
            } catch (innerErr) {}
        }
        res.redirect('/admin');
    }
});

app.post('/admin/hapus-berita/:id', cekAdmin, async (req, res) => {
    const id = req.params.id;
    try {
        await db.query('DELETE FROM berita WHERE id = ?', [id]);
        res.redirect('/admin');
    } catch (err) {
        res.redirect('/admin');
    }
});

// --- RUTE KHUSUS USER/WARGA ---
app.get('/user', cekUser, async (req, res) => {
    try {
        const [laporanSaya] = await db.query('SELECT * FROM laporan WHERE nama = ? ORDER BY id DESC', [req.session.user.username]);
        const [suratSaya] = await db.query('SELECT * FROM surat_pengantar WHERE nama = ? ORDER BY id DESC', [req.session.user.username]);
        res.render('user', { desa: infoDesa, user: req.session.user, laporan: laporanSaya, suratPengantar: suratSaya, error: req.query.error });
    } catch (err) {
        res.status(500).send("Database Error");
    }
});

app.post('/user/kirim-laporan', cekUser, upload.single('fotoLaporan'), async (req, res) => {
    const { tipe, isi } = req.body;
    const foto = req.file ? `uploads/${req.file.filename}` : null;
    const tanggal = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    
    try {
        if (foto) {
            await db.query(
                'INSERT INTO laporan (nama, tipe, isi, status, tanggal, foto) VALUES (?, ?, ?, ?, ?, ?)',
                [req.session.user.username, tipe, isi, 'Menunggu', tanggal, foto]
            );
        } else {
            await db.query(
                'INSERT INTO laporan (nama, tipe, isi, status, tanggal) VALUES (?, ?, ?, ?, ?)',
                [req.session.user.username, tipe, isi, 'Menunggu', tanggal]
            );
        }
        res.redirect('/user');
    } catch (err) {
        res.redirect('/user?error=Gagal mengirim laporan');
    }
});

app.get('/user/edit-laporan/:id', cekUser, async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query('SELECT * FROM laporan WHERE id = ? AND nama = ?', [id, req.session.user.username]);
        if (rows.length === 0) {
            return res.redirect('/user?error=Laporan tidak ditemukan');
        }
        res.render('edit-laporan', { user: req.session.user, laporan: rows[0] });
    } catch (err) {
        res.redirect('/user?error=Gagal memuat form edit');
    }
});

app.post('/user/edit-laporan/:id', cekUser, upload.single('fotoLaporan'), async (req, res) => {
    const { id } = req.params;
    const { tipe, isi } = req.body;
    const foto = req.file ? `uploads/${req.file.filename}` : null;
    try {
        if (foto) {
            await db.query('UPDATE laporan SET tipe = ?, isi = ?, foto = ? WHERE id = ? AND nama = ?', [tipe, isi, foto, id, req.session.user.username]);
        } else {
            await db.query('UPDATE laporan SET tipe = ?, isi = ? WHERE id = ? AND nama = ?', [tipe, isi, id, req.session.user.username]);
        }
        res.redirect('/user');
    } catch (err) {
        res.redirect('/user?error=Gagal memperbarui laporan');
    }
});

app.post('/user/hapus-laporan/:id', cekUser, async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM laporan WHERE id = ? AND nama = ?', [id, req.session.user.username]);
        res.redirect('/user');
    } catch (err) {
        res.redirect('/user?error=Gagal menghapus laporan');
    }
});

// Menjalankan server
app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});

module.exports = app;