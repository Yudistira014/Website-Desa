CREATE DATABASE IF NOT EXISTS web_desa;
USE web_desa;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('admin','user') NOT NULL DEFAULT 'user'
);

CREATE TABLE IF NOT EXISTS berita (
  id INT AUTO_INCREMENT PRIMARY KEY,
  judul VARCHAR(255),
  tanggal VARCHAR(100),
  ringkasan TEXT,
  foto VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS laporan (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nama VARCHAR(100),
  tipe VARCHAR(50),
  isi TEXT,
  status VARCHAR(50),
  tanggal VARCHAR(100),
  foto VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS anggaran (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tahun INT,
  rincian TEXT
);

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
);

CREATE TABLE IF NOT EXISTS statistik (
  id INT AUTO_INCREMENT PRIMARY KEY,
  warga INT DEFAULT 0,
  rumah INT DEFAULT 0,
  kegiatan TEXT
);

-- Default admin (username: admin, password: admin)
INSERT IGNORE INTO users (username, password, role) VALUES ('admin','admin','admin');
