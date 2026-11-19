require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const multer = require('multer');
const { put, del } = require('@vercel/blob');

const app = express();
const port = 3000;

// Konfigurasi EJS & File Statis (DIUBAH UNTUK VERCEL)
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));
app.use(express.static(path.join(process.cwd(), 'public')));

// Storage lokal (khusus pengembangan di komputer)
const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(process.cwd(), 'public', 'uploads')),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    }
});

// Gunakan memoryStorage agar kompatibel dengan Vercel Blob (untuk berita & laporan)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // Maksimal 5 MB
    fileFilter: (req, file, cb) => {
        if (/^image\//.test(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diizinkan'));
        }
    }
});

// Helper simpan gambar: otomatis ke Vercel Blob jika token tersedia / di Vercel, atau ke folder lokal
async function saveUploadedImage(file, folder = 'uploads') {
    if (!file) return null;

    const ext = path.extname(file.originalname) || '.jpg';
    const filename = `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

    if (process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL === '1') {
        const blob = await put(`${folder}/${filename}`, file.buffer, {
            access: 'public',
            contentType: file.mimetype
        });
        return blob.url;
    }

    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(path.join(uploadDir, filename), file.buffer);
    return `uploads/${filename}`;
}

const galleryImageTypes = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
};
const galleryImageFilter = (req, file, cb) => {
    if (galleryImageTypes[file.mimetype]) {
        cb(null, true);
    } else {
        cb(new Error('Foto galeri harus berformat JPEG, PNG, atau WebP'));
    }
};
const galleryImageLimits = { fileSize: 3 * 1024 * 1024 };
const galleryDiskUpload = multer({
    storage: diskStorage,
    limits: galleryImageLimits,
    fileFilter: galleryImageFilter
});
const galleryMemoryUpload = multer({
    storage: multer.memoryStorage(),
    limits: galleryImageLimits,
    fileFilter: galleryImageFilter
});

async function cleanupGalleryUploads(files) {
    for (const file of files) {
        try {
            await fs.unlink(file.path);
        } catch (err) {
            if (err.code !== 'ENOENT') console.error('Gagal membersihkan unggahan galeri:', err.message);
        }
    }
}

function isGalleryBlobUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' &&
            (url.hostname === 'blob.vercel-storage.com' || url.hostname.endsWith('.blob.vercel-storage.com'));
    } catch (err) {
        return false;
    }
}

function parseGalleryBlobUrls(value) {
    if (typeof value !== 'string') return null;

    try {
        const urls = JSON.parse(value);
        if (!Array.isArray(urls) || urls.length === 0 || urls.length > 10) return null;
        return urls.every(url => typeof url === 'string' && isGalleryBlobUrl(url)) ? urls : null;
    } catch (err) {
        return null;
    }
}

// Middleware untuk membaca data dari formulir (POST request)
app.use(express.urlencoded({ extended: true }));

// Konfigurasi Session untuk Fitur Login
const sessionSecret = process.env.SESSION_SECRET || 'secret-desa';
const AUTH_COOKIE_NAME = 'desa_auth';
const AUTH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari

function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
        const idx = cookie.indexOf('=');
        if (idx < 0) return;
        const key = cookie.slice(0, idx).trim();
        const val = cookie.slice(idx + 1).trim();
        try {
            list[key] = decodeURIComponent(val);
        } catch (err) {
            list[key] = val;
        }
    });
    return list;
}

function signAuthToken(user) {
    const payload = Buffer.from(JSON.stringify({
        username: user.username,
        role: user.role,
        exp: Date.now() + AUTH_MAX_AGE_MS
    })).toString('base64url');
    const sig = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}

function verifyAuthToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;
    const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!data || !data.username || !data.role || (data.exp && Date.now() > data.exp)) return null;
        return { username: data.username, role: data.role };
    } catch (err) {
        return null;
    }
}

function setAuthCookie(res, user) {
    res.cookie(AUTH_COOKIE_NAME, signAuthToken(user), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: AUTH_MAX_AGE_MS,
        path: '/'
    });
}

function clearAuthCookie(res) {
    res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
}

app.set('trust proxy', 1);
app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: AUTH_MAX_AGE_MS
    }
}));

// Pulihkan sesi login dari signed cookie & sediakan `user` di semua template EJS
app.use((req, res, next) => {
    if (!req.session.user) {
        const cookies = parseCookies(req.headers.cookie);
        const restoredUser = verifyAuthToken(cookies[AUTH_COOKIE_NAME]);
        if (restoredUser) {
            req.session.user = restoredUser;
        }
    }
    res.locals.user = req.session.user || null;
    res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    next();
});

// --- KONFIGURASI DATABASE MYSQL DENGAN SSL UNTUK TIDB ---
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'web_desa',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    ssl: {
        rejectUnauthorized: true // WAJIB DITAMBAHKAN UNTUK KONEKSI TIDB CLOUD
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// --- DATABASE SIMULASI (Data Asli Anda + Data Fitur Baru) ---
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
            icon: "👥",
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

app.locals.desa = infoDesa;

const defaultKependudukan = [
    { dusun: 'Dusun Karang', laki_laki: 620, perempuan: 605, kk: 340, balita: 95, anak_remaja: 260, dewasa: 710, lansia: 160 },
    { dusun: 'Dusun Mulyo', laki_laki: 590, perempuan: 580, kk: 325, balita: 88, anak_remaja: 245, dewasa: 690, lansia: 147 },
    { dusun: 'Dusun Makmur', laki_laki: 555, perempuan: 550, kk: 310, balita: 82, anak_remaja: 230, dewasa: 655, lansia: 138 }
];

async function ensureKependudukanTable(conn = db) {
    await conn.query(`
        CREATE TABLE IF NOT EXISTS kependudukan (
            id INT AUTO_INCREMENT PRIMARY KEY,
            dusun VARCHAR(100) NOT NULL UNIQUE,
            laki_laki INT NOT NULL DEFAULT 0,
            perempuan INT NOT NULL DEFAULT 0,
            kk INT NOT NULL DEFAULT 0,
            balita INT NOT NULL DEFAULT 0,
            anak_remaja INT NOT NULL DEFAULT 0,
            dewasa INT NOT NULL DEFAULT 0,
            lansia INT NOT NULL DEFAULT 0
        )
    `);
}

async function ensureDefaultKependudukan(conn = db) {
    try {
        await ensureKependudukanTable(conn);
        const [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM kependudukan');
        if (Number(total) === 0) {
            const values = defaultKependudukan.map(d => [
                d.dusun, d.laki_laki, d.perempuan, d.kk, d.balita, d.anak_remaja, d.dewasa, d.lansia
            ]);
            await conn.query(
                'INSERT INTO kependudukan (dusun, laki_laki, perempuan, kk, balita, anak_remaja, dewasa, lansia) VALUES ?',
                [values]
            );
        }
    } catch (err) {
        console.error('Gagal menyiapkan data awal kependudukan:', err.message);
    }
}

async function ensureKeuanganTable(conn = db) {
    await conn.query(`
        CREATE TABLE IF NOT EXISTS keuangan_desa (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tipe ENUM('masuk', 'keluar') NOT NULL,
            kategori VARCHAR(100) NOT NULL,
            keterangan VARCHAR(255) NOT NULL,
            nominal BIGINT NOT NULL DEFAULT 0,
            tanggal VARCHAR(100) NOT NULL
        )
    `);
}

async function ensureBantuanTable(conn = db) {
    await conn.query(`
        CREATE TABLE IF NOT EXISTS penerima_bantuan (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nama VARCHAR(120) NOT NULL,
            nik VARCHAR(50) NOT NULL,
            dusun VARCHAR(100) NOT NULL,
            kriteria VARCHAR(100) NOT NULL,
            jenis_bantuan VARCHAR(120) NOT NULL,
            nominal BIGINT NOT NULL DEFAULT 0,
            status VARCHAR(50) NOT NULL DEFAULT 'Belum Tersalurkan',
            catatan TEXT,
            tanggal VARCHAR(100) NOT NULL
        )
    `);
}

async function syncTotalPopulasi(conn = db) {
    try {
        await ensureDefaultKependudukan(conn);
        const [rows] = await conn.query('SELECT * FROM kependudukan ORDER BY id ASC');
        if (rows.length > 0) {
            const totalLaki = rows.reduce((sum, r) => sum + (Number(r.laki_laki) || 0), 0);
            const totalPerempuan = rows.reduce((sum, r) => sum + (Number(r.perempuan) || 0), 0);
            const totalKK = rows.reduce((sum, r) => sum + (Number(r.kk) || 0), 0);
            const totalJiwa = totalLaki + totalPerempuan;

            infoDesa.populasi = totalJiwa.toLocaleString('id-ID');
            infoDesa.totalLaki = totalLaki.toLocaleString('id-ID');
            infoDesa.totalPerempuan = totalPerempuan.toLocaleString('id-ID');
            infoDesa.totalKK = totalKK.toLocaleString('id-ID');
            infoDesa.kependudukan = rows;
            infoDesa.wilayah.dusun = rows.map(r => r.dusun);
            return rows;
        }
    } catch (err) {}
    return defaultKependudukan;
}

async function verifyDatabaseConnection() {
    try {
        const connection = await db.getConnection();
        await connection.ping();

        // MEMBUAT TABEL OTOMATIS JIKA BELUM ADA DI TIDB
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
        await connection.query(`
            CREATE TABLE IF NOT EXISTS berita (
                id INT AUTO_INCREMENT PRIMARY KEY,
                judul VARCHAR(255),
                tanggal VARCHAR(100),
                ringkasan TEXT,
                foto VARCHAR(255)
            )
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS galeri (
                id INT AUTO_INCREMENT PRIMARY KEY,
                judul VARCHAR(255) NOT NULL,
                tanggal VARCHAR(100) NOT NULL,
                deskripsi TEXT,
                foto VARCHAR(255) NOT NULL
            )
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100),
                password VARCHAR(255),
                role VARCHAR(50)
            )
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS kependudukan (
                id INT AUTO_INCREMENT PRIMARY KEY,
                dusun VARCHAR(100) NOT NULL UNIQUE,
                laki_laki INT NOT NULL DEFAULT 0,
                perempuan INT NOT NULL DEFAULT 0,
                kk INT NOT NULL DEFAULT 0,
                balita INT NOT NULL DEFAULT 0,
                anak_remaja INT NOT NULL DEFAULT 0,
                dewasa INT NOT NULL DEFAULT 0,
                lansia INT NOT NULL DEFAULT 0
            )
        `);
        await ensureDefaultKependudukan(connection);
        await ensureKeuanganTable(connection);
        await ensureBantuanTable(connection);
        await syncTotalPopulasi(connection);

        connection.release();
        console.log(`Database MySQL terhubung: ${process.env.DB_NAME || 'web_desa'}`);
    } catch (err) {
        console.error('Gagal terhubung ke database MySQL:', err.message);
    }
}

verifyDatabaseConnection();

// --- MIDDLEWARE KEAMANAN ---
function cekAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.redirect('/login?error=Akses Khusus Admin!');
    }
}

function cekUser(req, res, next) {
    if (req.session.user && (req.session.user.role === 'user' || req.session.user.role === 'admin')) {
        next();
    } else {
        res.redirect('/login?error=Silahkan Login Terlebih Dahulu!');
    }
}

// --- RUTE UTAMA (PUBLIC) ---
app.use(async (req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/uploads/')) {
        await syncTotalPopulasi();
    }
    next();
});

app.get('/', async (req, res) => {
    try {
        const [berita] = await db.query('SELECT * FROM berita ORDER BY id DESC LIMIT 3');
        const [galeri] = await db.query('SELECT id, judul, tanggal, foto FROM galeri ORDER BY id DESC LIMIT 6');
        res.render('index', { desa: infoDesa, berita, galeri, user: req.session.user });
    } catch (err) {
        res.status(500).send("Database Error di Halaman Utama: " + err.message);
    }
});

app.get('/galeri', async (req, res) => {
    try {
        const pageSize = 24;
        const requestedPage = Number.parseInt(req.query.page, 10);
        const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
        const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM galeri');
        const totalPages = Math.max(1, Math.ceil(Number(total) / pageSize));
        const currentPage = Math.min(page, totalPages);
        const offset = (currentPage - 1) * pageSize;
        const [galeri] = await db.query(
            'SELECT id, judul, tanggal, deskripsi, foto FROM galeri ORDER BY id DESC LIMIT ? OFFSET ?',
            [pageSize, offset]
        );

        res.render('galeri', {
            desa: infoDesa,
            user: req.session.user,
            galeri,
            currentPage,
            totalPages
        });
    } catch (err) {
        res.status(500).send("Database Error di Galeri: " + err.message);
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

app.get('/layanan/:slug', async (req, res) => {
    const layanan = infoDesa.layanan.find(item => item.slug === req.params.slug);
    if (!layanan) {
        return res.status(404).send('Layanan tidak ditemukan');
    }
    const success = req.query.success === '1';
    const error = req.query.error === '1';
    let penerimaBantuan = [];
    if (layanan.slug === 'bantuan-sosial') {
        try {
            await ensureBantuanTable();
            const [rows] = await db.query('SELECT * FROM penerima_bantuan ORDER BY id DESC');
            penerimaBantuan = rows;
        } catch (e) {}
    }
    res.render('layanan-detail', { desa: infoDesa, user: req.session.user, layanan, penerimaBantuan, success, error });
});

app.get('/transparansi', async (req, res) => {
    try {
        const [rincian] = await db.query('SELECT * FROM anggaran WHERE tahun = 2024');
        res.render('transparansi', { desa: infoDesa, anggaran: { rincian }, user: req.session.user });
    } catch (err) {
        res.status(500).send("Database Error di Halaman Transparansi: " + err.message);
    }
});

app.get('/statistik', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM statistik LIMIT 1');
        const statistik = rows[0] || {};
        res.render('statistik', { desa: infoDesa, statistik, user: req.session.user });
    } catch (err) {
        res.status(500).send("Database Error di Halaman Statistik: " + err.message);
    }
});

// --- RUTE LOGIN & LOGOUT ---
app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/user');
    }
    res.render('login', { error: req.query.error, success: req.query.success, user: req.session.user });
});

app.get('/register', (req, res) => {
    if (req.session.user) {
        return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/user');
    }
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
        res.redirect('/login?success=Registrasi berhasil! Silakan masuk.');
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
            const sessionUser = { username: user.username, role: user.role };
            req.session.user = sessionUser;
            setAuthCookie(res, sessionUser);
            req.session.save(() => {
                if (user.role === 'admin') {
                    res.redirect('/admin');
                } else {
                    res.redirect('/user');
                }
            });
        } else {
            res.redirect('/login?error=Username atau Password Salah!');
        }
    } catch (err) {
        res.redirect('/login?error=Terjadi kesalahan database.');
    }
});

app.get('/logout', (req, res) => {
    clearAuthCookie(res);
    req.session.destroy(() => {
        res.clearCookie('connect.sid', { path: '/' });
        res.redirect('/');
    });
});

// --- RUTE KHUSUS ADMIN ---
const adminValidSections = new Set([
    'ringkasan',
    'kependudukan',
    'keuangan',
    'bantuan-desa',
    'terbitkan-berita',
    'laporan-warga',
    'surat-pengantar',
    'kelola-galeri',
    'daftar-berita'
]);

async function renderAdminDashboard(req, res, section = 'ringkasan') {
    try {
        const [berita] = await db.query('SELECT * FROM berita ORDER BY id DESC');
        const [laporan] = await db.query('SELECT * FROM laporan ORDER BY id DESC');
        const [suratPengantar] = await db.query('SELECT * FROM surat_pengantar ORDER BY id DESC');
        const [galeri] = await db.query('SELECT * FROM galeri ORDER BY id DESC');
        let kependudukan = defaultKependudukan;
        try {
            await ensureDefaultKependudukan();
            const [rowsPenduduk] = await db.query('SELECT * FROM kependudukan ORDER BY id ASC');
            if (rowsPenduduk.length > 0) kependudukan = rowsPenduduk;
        } catch (e) {}
        let keuangan = [];
        try {
            await ensureKeuanganTable();
            const [rowsKeuangan] = await db.query('SELECT * FROM keuangan_desa ORDER BY id DESC');
            keuangan = rowsKeuangan;
        } catch (e) {}
        let bantuanWarga = [];
        try {
            await ensureBantuanTable();
            const [rowsBantuan] = await db.query('SELECT * FROM penerima_bantuan ORDER BY id DESC');
            bantuanWarga = rowsBantuan;
        } catch (e) {}
        await syncTotalPopulasi();
        res.render('admin', {
            desa: infoDesa,
            user: req.session.user,
            section,
            berita,
            galeri,
            laporanWarga: laporan,
            suratPengantar,
            kependudukan,
            keuangan,
            bantuanWarga,
            error: req.query.error,
            success: req.query.success,
            isVercel: process.env.VERCEL === '1',
            hasVercelBlobConfig: Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN)
        });
    } catch (err) {
        res.status(500).send("Database Error di Halaman Admin: " + err.message);
    }
}

app.get('/admin', cekAdmin, (req, res) => renderAdminDashboard(req, res, 'ringkasan'));

app.get('/admin/:section', cekAdmin, (req, res, next) => {
    const { section } = req.params;
    if (!adminValidSections.has(section)) return next();
    if (section === 'ringkasan') return res.redirect('/admin');
    return renderAdminDashboard(req, res, section);
});

app.post('/admin/keuangan/tambah', cekAdmin, async (req, res) => {
    const tipe = req.body.tipe === 'keluar' ? 'keluar' : 'masuk';
    const kategori = typeof req.body.kategori === 'string' ? req.body.kategori.trim() : '';
    const keterangan = typeof req.body.keterangan === 'string' ? req.body.keterangan.trim() : '';
    const nominalRaw = String(req.body.nominal || req.body.nominal_display || '').replace(/\D/g, '');
    const nominal = Number.parseInt(nominalRaw, 10) || 0;
    const tanggalInput = typeof req.body.tanggal === 'string' && req.body.tanggal.trim()
        ? req.body.tanggal.trim()
        : new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    if (!kategori || !keterangan || nominal <= 0) {
        return res.redirect('/admin/keuangan?error=Lengkapi kategori, keterangan, dan nominal dana yang valid');
    }

    try {
        await ensureKeuanganTable();
        await db.query(
            'INSERT INTO keuangan_desa (tipe, kategori, keterangan, nominal, tanggal) VALUES (?, ?, ?, ?, ?)',
            [tipe, kategori, keterangan, nominal, tanggalInput]
        );
        res.redirect(`/admin/keuangan?success=Transaksi dana ${tipe === 'masuk' ? 'masuk' : 'keluar'} berhasil dicatat`);
    } catch (err) {
        console.error('Gagal mencatat transaksi keuangan:', err.message);
        res.redirect('/admin/keuangan?error=Gagal menyimpan transaksi keuangan');
    }
});

app.post('/admin/keuangan/:id/hapus', cekAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
        return res.redirect('/admin/keuangan?error=Data transaksi tidak valid');
    }
    try {
        await ensureKeuanganTable();
        await db.query('DELETE FROM keuangan_desa WHERE id = ?', [id]);
        res.redirect('/admin/keuangan?success=Riwayat transaksi berhasil dihapus');
    } catch (err) {
        res.redirect('/admin/keuangan?error=Gagal menghapus riwayat transaksi');
    }
});

app.post('/admin/bantuan/tambah', cekAdmin, async (req, res) => {
    const nama = typeof req.body.nama === 'string' ? req.body.nama.trim() : '';
    const nik = typeof req.body.nik === 'string' ? req.body.nik.trim() : '';
    const dusun = typeof req.body.dusun === 'string' ? req.body.dusun.trim() : '';
    const kriteria = typeof req.body.kriteria === 'string' ? req.body.kriteria.trim() : '';
    const jenisBantuan = typeof req.body.jenis_bantuan === 'string' ? req.body.jenis_bantuan.trim() : '';
    const nominalRaw = String(req.body.nominal || req.body.nominal_display || '').replace(/\D/g, '');
    const nominal = Number.parseInt(nominalRaw, 10) || 0;
    const status = req.body.status === 'Tersalurkan' ? 'Tersalurkan' : 'Belum Tersalurkan';
    const catatan = typeof req.body.catatan === 'string' ? req.body.catatan.trim() : '';
    const tanggal = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    if (!nama || !nik || !dusun || !kriteria || !jenisBantuan) {
        return res.redirect('/admin/bantuan-desa?error=Lengkapi data warga penerima bantuan dengan benar');
    }

    try {
        await ensureBantuanTable();
        await db.query(
            `INSERT INTO penerima_bantuan (nama, nik, dusun, kriteria, jenis_bantuan, nominal, status, catatan, tanggal)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [nama, nik, dusun, kriteria, jenisBantuan, nominal, status, catatan || null, tanggal]
        );
        res.redirect(`/admin/bantuan-desa?success=Data warga penerima bantuan (${nama}) berhasil ditambahkan`);
    } catch (err) {
        console.error('Gagal menambah penerima bantuan:', err.message);
        res.redirect('/admin/bantuan-desa?error=Gagal menyimpan data penerima bantuan');
    }
});

app.post('/admin/bantuan/:id/status', cekAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
        return res.redirect('/admin/bantuan-desa?error=Data penerima bantuan tidak valid');
    }
    const statusBaru = req.body.status === 'Tersalurkan' ? 'Tersalurkan' : 'Belum Tersalurkan';
    try {
        await ensureBantuanTable();
        await db.query('UPDATE penerima_bantuan SET status = ? WHERE id = ?', [statusBaru, id]);
        res.redirect(`/admin/bantuan-desa?success=Status bantuan berhasil diperbarui menjadi ${statusBaru}`);
    } catch (err) {
        res.redirect('/admin/bantuan-desa?error=Gagal memperbarui status bantuan');
    }
});

app.post('/admin/bantuan/:id/hapus', cekAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
        return res.redirect('/admin/bantuan-desa?error=Data penerima bantuan tidak valid');
    }
    try {
        await ensureBantuanTable();
        await db.query('DELETE FROM penerima_bantuan WHERE id = ?', [id]);
        res.redirect('/admin/bantuan-desa?success=Data penerima bantuan berhasil dihapus');
    } catch (err) {
        res.redirect('/admin/bantuan-desa?error=Gagal menghapus data penerima bantuan');
    }
});

app.post('/admin/kependudukan', cekAdmin, async (req, res) => {
    const toInt = val => Math.max(0, Number.parseInt(val, 10) || 0);
    const dusunList = Array.isArray(req.body.dusun) ? req.body.dusun : [req.body.dusun];
    const lakiList = Array.isArray(req.body.laki_laki) ? req.body.laki_laki : [req.body.laki_laki];
    const perempuanList = Array.isArray(req.body.perempuan) ? req.body.perempuan : [req.body.perempuan];
    const kkList = Array.isArray(req.body.kk) ? req.body.kk : [req.body.kk];
    const balitaList = Array.isArray(req.body.balita) ? req.body.balita : [req.body.balita];
    const remajaList = Array.isArray(req.body.anak_remaja) ? req.body.anak_remaja : [req.body.anak_remaja];
    const dewasaList = Array.isArray(req.body.dewasa) ? req.body.dewasa : [req.body.dewasa];
    const lansiaList = Array.isArray(req.body.lansia) ? req.body.lansia : [req.body.lansia];

    try {
        await ensureDefaultKependudukan();
        for (let i = 0; i < dusunList.length; i++) {
            const namaDusun = (dusunList[i] || '').trim();
            if (!namaDusun) continue;
            const laki = toInt(lakiList[i]);
            const perempuan = toInt(perempuanList[i]);
            const kk = toInt(kkList[i]);
            const balita = toInt(balitaList[i]);
            const remaja = toInt(remajaList[i]);
            const dewasa = toInt(dewasaList[i]);
            const lansia = toInt(lansiaList[i]);

            await db.query(
                `INSERT INTO kependudukan (dusun, laki_laki, perempuan, kk, balita, anak_remaja, dewasa, lansia)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    laki_laki = VALUES(laki_laki),
                    perempuan = VALUES(perempuan),
                    kk = VALUES(kk),
                    balita = VALUES(balita),
                    anak_remaja = VALUES(anak_remaja),
                    dewasa = VALUES(dewasa),
                    lansia = VALUES(lansia)`,
                [namaDusun, laki, perempuan, kk, balita, remaja, dewasa, lansia]
            );
        }
        await syncTotalPopulasi();
        res.redirect('/admin/kependudukan?success=Data statistik kependudukan berhasil diperbarui');
    } catch (err) {
        console.error('Gagal menyimpan kependudukan:', err.message);
        res.redirect('/admin/kependudukan?error=Gagal menyimpan data kependudukan');
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
        return res.redirect('/admin/surat-pengantar');
    }

    try {
        const [rows] = await db.query('SELECT status, alasan_penolakan FROM surat_pengantar WHERE id = ?', [id]);
        if (rows.length === 0) {
            return res.redirect('/admin/surat-pengantar');
        }

        const surat = rows[0];
        if (surat.status === 'Ditolak' && surat.alasan_penolakan) {
            return res.redirect('/admin/surat-pengantar');
        }

        if (action === 'tolak') {
            await db.query('UPDATE surat_pengantar SET status = ?, alasan_penolakan = ? WHERE id = ?', [status, alasanPenolakan || null, id]);
        } else {
            await db.query('UPDATE surat_pengantar SET status = ?, alasan_penolakan = NULL WHERE id = ?', [status, id]);
        }
        res.redirect('/admin/surat-pengantar?success=Status surat pengantar berhasil diperbarui');
    } catch (err) {
        res.redirect('/admin/surat-pengantar?error=Gagal memperbarui status surat');
    }
});

app.post('/admin/surat-pengantar/hapus-selesai', cekAdmin, async (req, res) => {
    try {
        await db.query("DELETE FROM surat_pengantar WHERE status IN ('Disetujui', 'Ditolak')");
        res.redirect('/admin/surat-pengantar?success=Seluruh riwayat surat yang sudah diproses berhasil dihapus');
    } catch (err) {
        res.redirect('/admin/surat-pengantar?error=Gagal menghapus riwayat surat pengantar');
    }
});

app.post('/admin/surat-pengantar/:id/hapus', cekAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
        return res.redirect('/admin/surat-pengantar?error=Data surat tidak valid');
    }
    try {
        await db.query('DELETE FROM surat_pengantar WHERE id = ?', [id]);
        res.redirect('/admin/surat-pengantar?success=Riwayat surat pengantar berhasil dihapus');
    } catch (err) {
        res.redirect('/admin/surat-pengantar?error=Gagal menghapus riwayat surat pengantar');
    }
});

app.post('/admin/tambah-berita', cekAdmin, upload.single('fotoBerita'), async (req, res) => {
    const { judul, ringkasan } = req.body;
    const tanggalHariIni = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    try {
        const foto = await saveUploadedImage(req.file, 'berita');
        if (foto) {
            await db.query('INSERT INTO berita (judul, tanggal, ringkasan, foto) VALUES (?, ?, ?, ?)', [judul, tanggalHariIni, ringkasan, foto]);
        } else {
            await db.query('INSERT INTO berita (judul, tanggal, ringkasan) VALUES (?, ?, ?)', [judul, tanggalHariIni, ringkasan]);
        }
        res.redirect('/admin/daftar-berita?success=Berita baru berhasil diterbitkan');
    } catch (err) {
        console.error('Gagal menambah berita:', err.message);
        if (req.file && err.code === 'ER_BAD_FIELD_ERROR') {
            try {
                await db.query('INSERT INTO berita (judul, tanggal, ringkasan) VALUES (?, ?, ?)', [judul, tanggalHariIni, ringkasan]);
                return res.redirect('/admin/daftar-berita?success=Berita baru berhasil diterbitkan');
            } catch (innerErr) {}
        }
        res.redirect('/admin/terbitkan-berita?error=Gagal menambah berita');
    }
});

app.post('/admin/upload-galeri-file', cekAdmin, (req, res, next) => {
    galleryMemoryUpload.single('fotoGaleri')(req, res, err => {
        if (!err) return next();
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        res.status(status).json({
            error: status === 413 ? 'Ukuran setiap foto maksimal 3 MB' : err.message
        });
    });
}, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Pilih foto dokumentasi terlebih dahulu' });

    try {
        const extension = galleryImageTypes[req.file.mimetype];
        const blob = await put(`galeri/${crypto.randomUUID()}.${extension}`, req.file.buffer, {
            access: 'public',
            contentType: req.file.mimetype
        });
        res.status(201).json({ url: blob.url });
    } catch (err) {
        console.error('Gagal mengunggah foto ke Vercel Blob:', err.message);
        res.status(503).json({
            error: 'Penyimpanan galeri belum siap. Hubungkan Vercel Blob ke project terlebih dahulu.'
        });
    }
});

app.post('/admin/tambah-galeri-remote', cekAdmin, async (req, res) => {
    const judul = typeof req.body.judul === 'string' ? req.body.judul.trim() : '';
    const deskripsi = typeof req.body.deskripsi === 'string' ? req.body.deskripsi.trim() : '';
    const urls = parseGalleryBlobUrls(req.body.fotoUrls);

    if (!judul || judul.length > 255 || !urls) {
        return res.status(400).json({ error: 'Data dokumentasi galeri tidak valid' });
    }

    const tanggal = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const values = urls.map(url => [judul, tanggal, deskripsi || null, url]);

    try {
        await db.query('INSERT INTO galeri (judul, tanggal, deskripsi, foto) VALUES ?', [values]);
        res.json({ redirect: '/admin/kelola-galeri?success=Dokumentasi berhasil ditambahkan ke galeri' });
    } catch (err) {
        console.error('Gagal menyimpan dokumentasi galeri:', err.message);
        res.status(500).json({ error: 'Gagal menyimpan dokumentasi galeri' });
    }
});

app.post('/admin/hapus-upload-galeri-temp', cekAdmin, async (req, res) => {
    const urls = parseGalleryBlobUrls(req.body.fotoUrls);
    if (!urls) return res.status(400).json({ error: 'Daftar foto galeri tidak valid' });

    try {
        await del(urls);
        res.sendStatus(204);
    } catch (err) {
        console.error('Gagal membersihkan unggahan galeri sementara:', err.message);
        res.status(502).json({ error: 'Gagal membersihkan foto galeri sementara' });
    }
});

app.post('/admin/tambah-galeri', cekAdmin, (req, res, next) => {
    if (process.env.VERCEL === '1') {
        return res.redirect('/admin/kelola-galeri?error=Aktifkan JavaScript untuk mengunggah foto galeri');
    }
    galleryDiskUpload.array('fotoGaleri', 10)(req, res, err => {
        if (err) {
            console.error('Gagal menerima unggahan galeri:', err.message);
            return res.redirect('/admin/kelola-galeri?error=Gagal menerima foto galeri');
        }
        next();
    });
}, async (req, res) => {
    const judul = typeof req.body.judul === 'string' ? req.body.judul.trim() : '';
    const deskripsi = typeof req.body.deskripsi === 'string' ? req.body.deskripsi.trim() : '';
    const files = Array.isArray(req.files) ? req.files : [];

    if (!judul || judul.length > 255 || files.length === 0) {
        await cleanupGalleryUploads(files);
        return res.redirect('/admin/kelola-galeri?error=Lengkapi judul dan pilih foto galeri');
    }

    const tanggal = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const values = files.map(file => [judul, tanggal, deskripsi || null, `uploads/${file.filename}`]);

    try {
        await db.query('INSERT INTO galeri (judul, tanggal, deskripsi, foto) VALUES ?', [values]);
        res.redirect('/admin/kelola-galeri?success=Dokumentasi berhasil ditambahkan ke galeri');
    } catch (err) {
        console.error('Gagal menyimpan dokumentasi galeri:', err.message);
        await cleanupGalleryUploads(files);
        res.redirect('/admin/kelola-galeri?error=Gagal menyimpan dokumentasi galeri');
    }
});

app.post('/admin/hapus-galeri/:id', cekAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
        return res.redirect('/admin/kelola-galeri?error=Dokumentasi galeri tidak valid');
    }

    try {
        const [rows] = await db.query('SELECT foto FROM galeri WHERE id = ?', [id]);
        if (rows.length === 0) return res.redirect('/admin/kelola-galeri?error=Dokumentasi galeri tidak ditemukan');

        await db.query('DELETE FROM galeri WHERE id = ?', [id]);
        if (isGalleryBlobUrl(rows[0].foto)) {
            await del(rows[0].foto);
        } else if (process.env.VERCEL !== '1') {
            const filename = path.basename(rows[0].foto || '');
            if (filename) {
                try {
                    await fs.unlink(path.join(process.cwd(), 'public', 'uploads', filename));
                } catch (err) {
                    if (err.code !== 'ENOENT') {
                        console.error('Gagal menghapus file dokumentasi galeri:', err.message);
                        return res.redirect('/admin/kelola-galeri?error=Dokumentasi dihapus, tetapi file gagal dibersihkan');
                    }
                }
            }
        }
        res.redirect('/admin/kelola-galeri?success=Dokumentasi galeri berhasil dihapus');
    } catch (err) {
        console.error('Gagal menghapus dokumentasi galeri:', err.message);
        res.redirect('/admin/kelola-galeri?error=Gagal menghapus dokumentasi galeri');
    }
});

app.get('/admin/edit-berita/:id', cekAdmin, async (req, res) => {
    const id = req.params.id;
    try {
        const [rows] = await db.query('SELECT * FROM berita WHERE id = ?', [id]);
        if (rows.length > 0) {
            res.render('edit-berita', { user: req.session.user, berita: rows[0], id });
        } else {
            res.redirect('/admin/daftar-berita');
        }
    } catch (err) {
        res.redirect('/admin/daftar-berita');
    }
});

app.post('/admin/edit-berita/:id', cekAdmin, upload.single('fotoBerita'), async (req, res) => {
    const id = req.params.id;
    const { judul, ringkasan } = req.body;
    try {
        const foto = await saveUploadedImage(req.file, 'berita');
        if (foto) {
            await db.query('UPDATE berita SET judul = ?, ringkasan = ?, foto = ? WHERE id = ?', [judul, ringkasan, foto, id]);
        } else {
            await db.query('UPDATE berita SET judul = ?, ringkasan = ? WHERE id = ?', [judul, ringkasan, id]);
        }
        res.redirect('/admin/daftar-berita?success=Berita berhasil diperbarui');
    } catch (err) {
        console.error('Gagal memperbarui berita:', err.message);
        if (req.file && err.code === 'ER_BAD_FIELD_ERROR') {
            try {
                await db.query('UPDATE berita SET judul = ?, ringkasan = ? WHERE id = ?', [judul, ringkasan, id]);
                return res.redirect('/admin/daftar-berita?success=Berita berhasil diperbarui');
            } catch (innerErr) {}
        }
        res.redirect('/admin/daftar-berita?error=Gagal memperbarui berita');
    }
});

app.post('/admin/hapus-berita/:id', cekAdmin, async (req, res) => {
    const id = req.params.id;
    try {
        const [rows] = await db.query('SELECT foto FROM berita WHERE id = ?', [id]);
        await db.query('DELETE FROM berita WHERE id = ?', [id]);
        if (rows.length > 0 && isGalleryBlobUrl(rows[0].foto)) {
            await del(rows[0].foto).catch(() => {});
        }
        res.redirect('/admin/daftar-berita?success=Berita berhasil dihapus');
    } catch (err) {
        res.redirect('/admin/daftar-berita?error=Gagal menghapus berita');
    }
});

// --- RUTE KHUSUS USER/WARGA ---
app.get('/user', cekUser, async (req, res) => {
    try {
        const [laporanSaya] = await db.query('SELECT * FROM laporan WHERE nama = ? ORDER BY id DESC', [req.session.user.username]);
        const [suratSaya] = await db.query('SELECT * FROM surat_pengantar WHERE nama = ? ORDER BY id DESC', [req.session.user.username]);
        let penerimaBantuan = [];
        try {
            await ensureBantuanTable();
            const [rowsBantuan] = await db.query('SELECT * FROM penerima_bantuan ORDER BY id DESC');
            penerimaBantuan = rowsBantuan;
        } catch (e) {}
        res.render('user', {
            desa: infoDesa,
            user: req.session.user,
            laporan: laporanSaya,
            suratPengantar: suratSaya,
            penerimaBantuan,
            error: req.query.error
        });
    } catch (err) {
        res.status(500).send("Database Error di Halaman User: " + err.message);
    }
});

app.post('/user/kirim-laporan', cekUser, upload.single('fotoLaporan'), async (req, res) => {
    const { tipe, isi } = req.body;
    const tanggal = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    try {
        const foto = await saveUploadedImage(req.file, 'laporan');
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
        console.error('Gagal mengirim laporan:', err.message);
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
    try {
        const foto = await saveUploadedImage(req.file, 'laporan');
        if (foto) {
            await db.query('UPDATE laporan SET tipe = ?, isi = ?, foto = ? WHERE id = ? AND nama = ?', [tipe, isi, foto, id, req.session.user.username]);
        } else {
            await db.query('UPDATE laporan SET tipe = ?, isi = ? WHERE id = ? AND nama = ?', [tipe, isi, id, req.session.user.username]);
        }
        res.redirect('/user');
    } catch (err) {
        console.error('Gagal memperbarui laporan:', err.message);
        res.redirect('/user?error=Gagal memperbarui laporan');
    }
});

app.post('/user/hapus-laporan/:id', cekUser, async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query('SELECT foto FROM laporan WHERE id = ? AND nama = ?', [id, req.session.user.username]);
        await db.query('DELETE FROM laporan WHERE id = ? AND nama = ?', [id, req.session.user.username]);
        if (rows.length > 0 && isGalleryBlobUrl(rows[0].foto)) {
            await del(rows[0].foto).catch(() => {});
        }
        res.redirect('/user');
    } catch (err) {
        res.redirect('/user?error=Gagal menghapus laporan');
    }
});

// Hanya jalankan app.listen jika di komputer lokal (bukan di produksi/Vercel)
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Server berjalan di http://localhost:${port}`);
    });
}

module.exports = app;