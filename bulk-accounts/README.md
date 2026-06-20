# 🤖 Bulk Account Harvester

Otomasi harvesting API key dari berbagai AI provider menggunakan Camoufox (Firefox anti-detect). Satu akun Google = satu sesi browser, iterasi ke semua provider yang dipilih.

---

## 📦 Providers yang Didukung

| Key | Platform | API Key Prefix |
|---|---|---|
| `gemini` | Google AI Studio | `AIza...` |
| `groq` | Groq Console | `gsk_...` |
| `cerebras` | Cerebras Cloud | `csk_...` |
| `chutes` | Chutes.ai | — |
| `hyperbolic` | Hyperbolic | — |
| `siliconflow` | SiliconFlow | — |
| `cohere` | Cohere Dashboard | — |
| `mistral` | Mistral Admin | — |

---

## ⚙️ Setup

### 1. Install dependencies

```bash
cd bulk-accounts
pip install -r requirements-harvest.txt
```

### 2. Install Camoufox browser

```bash
python -m camoufox fetch
```

> Hanya perlu sekali. Download Firefox yang sudah di-patch Camoufox.

---

## 📄 Format File Akun

### Opsi A — `accounts.txt` (email:password per baris)

```
# Komentar diawali # akan diabaikan
user1@gmail.com:password1
user2@gmail.com:password2
user3@gmail.com:password3
```

### Opsi B — `accounts.json` (format JSON array)

```json
[
  {"email": "user1@gmail.com", "password": "password1"},
  {"email": "user2@gmail.com", "password": "password2"}
]
```

---

## 🚀 Cara Run

### Mode 1 — CLI Langsung (Terminal)

**Run semua akun dari txt file:**
```bash
python run.py --file accounts.txt
```

**Run dari JSON file:**
```bash
python run.py --accounts accounts.json
```

**Run satu akun langsung dari CMD:**
```bash
  python run.py --email user@gmail.com --password mypassword
```

**Dengan pengaturan lengkap:**
```bash
python run.py --file accounts.txt --concurrent 3 --proxy http://user:pass@host:port --providers groq,gemini,cerebras --timeout 180
```

**Provider tertentu saja:**
```bash
python run.py --file accounts.txt --providers groq,gemini
```

**Semua provider:**
```bash
python run.py --file accounts.txt --providers all
```

**Tampilkan browser (untuk debug):**
```bash
python run.py --file accounts.txt --no-headless
```

**Lihat semua opsi:**
```bash
python run.py --help
```

---

### Mode 2 — Dashboard Web (Monitoring Real-time)

```bash
python run.py --server
```

> Anda juga bisa tetap menggunakan `python server.py`, keduanya mengarah ke server yang sama.

Lalu buka browser:
```
http://127.0.0.1:8765
```

Dashboard menampilkan:
- Slot browser per akun (real-time screenshot)
- Log progress & error per slot
- Harvested keys langsung muncul di sidebar kanan
- Kontrol: Start, Stop, pilih provider, set concurrent & proxy

**Port custom:**
```bash
python run.py --server --port 9000
```

---

## 🔧 Semua Opsi CLI

| Opsi | Default | Keterangan |
|---|---|---|
| `--file FILE.txt` | — | Input dari txt (email:password per baris) |
| `--accounts FILE.json` | `accounts.json` | Input dari JSON |
| `--email EMAIL` | — | Satu akun langsung dari CMD |
| `--password PASS` | — | Password untuk `--email` |
| `--concurrent N` | `2` | Jumlah browser yang jalan bersamaan |
| `--proxy URL` | — | Proxy: `http://user:pass@host:port` |
| `--providers LIST` | `all` | Provider: `groq,gemini` atau `all` |
| `--timeout SECONDS` | `120` | Timeout per provider per akun |
| `--output-dir DIR` | `outputs/` | Folder output hasil harvest |
| `--no-headless` | — | Tampilkan jendela browser (untuk debug) |
| `--server`, `-s` | — | Jalankan dashboard server dibanding CLI harvester |
| `--port PORT` | `8765` | Port yang digunakan dashboard server |

**Proxy juga bisa lewat env var:**
```bash
set BATCHER_PROXY_URL=http://user:pass@host:port
python run.py --file accounts.txt
```

**Headless juga bisa lewat env var:**
```bash
set BATCHER_CAMOUFOX_HEADLESS=false   # tampilkan browser
set BATCHER_CAMOUFOX_HEADLESS=true    # headless (default)
```

---

## 📁 Format Output

File disimpan otomatis di `outputs/harvest-YYYYMMDD-HHMMSS.txt`:

```
#======= Google AI Studio (Gemini) ======#
azisrana07:AIzaSyXxxxxxxxxxxxxxxxxxxxxxxxxxxx
baimkena81:AIzaSyYyyyyyyyyyyyyyyyyyyyyyyyyyyyy

#======= Groq ======#
azisrana07:gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
baimkena81:gsk_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy

#======= Cerebras ======#
azisrana07:csk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Format per baris: `namaakun:apikey` (nama = bagian email sebelum `@`)

---

## 📂 Struktur Project

```
bulk-accounts/
├── run.py                  # Entry point CLI
├── server.py               # Dashboard WebSocket server
├── dashboard.html          # Dashboard UI (dilayani server.py)
├── accounts.txt            # Contoh input format txt
├── accounts.json           # Contoh input format JSON
├── requirements-harvest.txt
├── outputs/                # Hasil harvest (auto-created)
│   └── harvest-20250527-083000.txt
└── harvest/                # Package provider
    ├── __init__.py
    ├── base.py             # Google OAuth + shared helpers
    ├── utils.py            # Faker generators + selector helpers
    ├── google_ai_studio.py
    ├── groq.py
    ├── cerebras.py
    ├── chutes.py
    ├── hyperbolic.py
    ├── siliconflow.py
    ├── cohere.py
    └── mistral.py
```

---

## ⚠️ Catatan Penting

- **Google Login**: Setiap akun login Google satu kali, lalu navigate ke semua provider dalam satu sesi browser yang sama.
- **2FA / Challenge**: Jika akun trigger 2FA atau phone verification dari Google, proses akan timeout. Pastikan akun sudah pernah login di browser sebelumnya.
- **Concurrent**: Setiap slot = 1 browser instance terpisah. Terlalu banyak concurrent bisa memakan RAM lebih besar. Rekomendasi: `--concurrent 2-5`.
- **Proxy**: Jika provider memblokir IP, gunakan proxy per-akun. Satu proxy berlaku untuk semua provider dalam satu sesi.
- **Selector**: Jika provider update UI mereka, update selector di file provider yang bersangkutan di `harvest/`. Selector ada di `selector.html` sebagai referensi.
