/* =========================================================
   TokoKu · Kwitansi Otomatis
   Alur: pilih barang -> keranjang -> isi data pembeli ->
         checkout -> kwitansi otomatis -> cetak / simpan PDF
   Data riwayat disimpan di localStorage (tanpa server).
   ========================================================= */

// ---------- Konfigurasi toko (ubah sesuai kebutuhan) ----------
const TOKO = {
  nama: "TokoKu",
  alamat: "Jl. Raya Kampus No. 1, Surabaya",
  telp: "031-5550123",
  kasir: "Admin TokoKu",
};
const PPN = 0.11;               // 11%
const BATAS_METERAI = 5_000_000; // transaksi di atas Rp5.000.000 perlu meterai
const KEY_RIWAYAT = "tokoku_riwayat";
const KEY_COUNTER = "tokoku_counter";

// ---------- Data produk ----------
const PRODUK = [
  { id: 1, nama: "Kaos Polos Katun",   kategori: "Fashion",    harga: 85000,   warna: "#3c4a85" },
  { id: 2, nama: "Kemeja Flanel",      kategori: "Fashion",    harga: 185000,  warna: "#8a4b3d" },
  { id: 3, nama: "Celana Chino",       kategori: "Fashion",    harga: 225000,  warna: "#5b6b4e" },
  { id: 4, nama: "Jaket Hoodie",       kategori: "Fashion",    harga: 275000,  warna: "#4a4f63" },
  { id: 5, nama: "Sepatu Sneakers",    kategori: "Fashion",    harga: 450000,  warna: "#7a5c2e" },
  { id: 6, nama: "Tas Ransel",         kategori: "Aksesoris",  harga: 320000,  warna: "#2f6b73" },
  { id: 7, nama: "Topi Baseball",      kategori: "Aksesoris",  harga: 65000,   warna: "#7b3f5e" },
  { id: 8, nama: "Jam Tangan Digital", kategori: "Aksesoris",  harga: 550000,  warna: "#35557a" },
  { id: 9, nama: "Headset Bluetooth",  kategori: "Elektronik", harga: 750000,  warna: "#5a3f7a" },
  { id: 10, nama: "Laptop Ultrabook",  kategori: "Elektronik", harga: 6500000, warna: "#1f4f5f" },
];

// ---------- State ----------
let cart = [];        // [{id, qty}]
let kwitansiAktif = null;

// ---------- Helper ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const rupiah = (n) => "Rp" + Math.round(n).toLocaleString("id-ID");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const baca = (key, def) => { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } };
const simpan = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* abaikan */ } };

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

// Terbilang rupiah: 1.250.000 -> "satu juta dua ratus lima puluh ribu rupiah"
const SATUAN = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
function terbilang(n) {
  n = Math.floor(n);
  if (n < 12) return SATUAN[n];
  if (n < 20) return terbilang(n - 10) + " belas";
  if (n < 100) return terbilang(Math.floor(n / 10)) + " puluh" + (n % 10 ? " " + terbilang(n % 10) : "");
  if (n < 200) return "seratus" + (n % 100 ? " " + terbilang(n % 100) : "");
  if (n < 1000) return terbilang(Math.floor(n / 100)) + " ratus" + (n % 100 ? " " + terbilang(n % 100) : "");
  if (n < 2000) return "seribu" + (n % 1000 ? " " + terbilang(n % 1000) : "");
  if (n < 1e6) return terbilang(Math.floor(n / 1e3)) + " ribu" + (n % 1e3 ? " " + terbilang(n % 1e3) : "");
  if (n < 1e9) return terbilang(Math.floor(n / 1e6)) + " juta" + (n % 1e6 ? " " + terbilang(n % 1e6) : "");
  if (n < 1e12) return terbilang(Math.floor(n / 1e9)) + " miliar" + (n % 1e9 ? " " + terbilang(n % 1e9) : "");
  return terbilang(Math.floor(n / 1e12)) + " triliun" + (n % 1e12 ? " " + terbilang(n % 1e12) : "");
}
const terbilangRupiah = (n) => (n === 0 ? "nol" : terbilang(n)) + " rupiah";

// Nomor kwitansi otomatis: KWT/2026/10/0001 (counter naik tiap transaksi)
function nomorBaru() {
  const d = new Date();
  const urut = (baca(KEY_COUNTER, 0) || 0) + 1;
  simpan(KEY_COUNTER, urut);
  const bln = String(d.getMonth() + 1).padStart(2, "0");
  return `KWT/${d.getFullYear()}/${bln}/${String(urut).padStart(4, "0")}`;
}

const tglIndo = (iso) =>
  new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

// ---------- Katalog ----------
function renderProduk() {
  const q = $("#search").value.trim().toLowerCase();
  const list = PRODUK.filter((p) => (p.nama + " " + p.kategori).toLowerCase().includes(q));
  $("#productGrid").innerHTML = list.length
    ? list.map((p) => `
      <div class="card">
        <div class="thumb" style="background:${p.warna}" aria-hidden="true">${esc(p.nama[0])}</div>
        <div class="name">${esc(p.nama)}</div>
        <div class="cat">${esc(p.kategori)}</div>
        <div class="price">${rupiah(p.harga)}</div>
        <button class="btn" data-add="${p.id}">Tambah</button>
      </div>`).join("")
    : `<div class="empty">Barang “${esc(q)}” tidak ditemukan.</div>`;
}

// ---------- Keranjang ----------
const produkById = (id) => PRODUK.find((p) => p.id === id);

function hitung() {
  const subtotal = cart.reduce((s, c) => s + produkById(c.id).harga * c.qty, 0);
  const ppn = Math.round(subtotal * PPN);
  return { subtotal, ppn, total: subtotal + ppn };
}

function renderCart() {
  const kosong = cart.length === 0;
  $("#cartEmpty").hidden = !kosong;
  $("#cartList").innerHTML = cart.map((c) => {
    const p = produkById(c.id);
    return `
      <li>
        <div><div class="n">${esc(p.nama)}</div><div class="p">${rupiah(p.harga)}</div></div>
        <div class="sub">${rupiah(p.harga * c.qty)}</div>
        <div></div>
        <div class="qty">
          <button data-dec="${p.id}" aria-label="Kurangi ${esc(p.nama)}">−</button>
          <span>${c.qty}</span>
          <button data-inc="${p.id}" aria-label="Tambah ${esc(p.nama)}">+</button>
        </div>
      </li>`;
  }).join("");
  const { subtotal, ppn, total } = hitung();
  $("#sumSubtotal").textContent = rupiah(subtotal);
  $("#sumPpn").textContent = rupiah(ppn);
  $("#sumTotal").textContent = rupiah(total);
  $("#btnCheckout").disabled = kosong;
}

function ubahQty(id, delta) {
  const item = cart.find((c) => c.id === id);
  if (!item) {
    if (delta > 0) cart.push({ id, qty: 1 });
  } else {
    item.qty += delta;
    if (item.qty <= 0) cart = cart.filter((c) => c.id !== id);
  }
  renderCart();
}

// ---------- Checkout & validasi ----------
function validasi(form) {
  let ok = true;
  const aturan = {
    nama: (v) => (v.length < 3 ? "Nama minimal 3 karakter." : ""),
    hp: (v) => (/^(\+62|62|0)8\d{7,11}$/.test(v.replace(/[\s-]/g, "")) ? "" : "Nomor HP tidak valid (contoh 081234567890)."),
    alamat: (v) => (v.length < 5 ? "Alamat wajib diisi." : ""),
  };
  for (const [name, cek] of Object.entries(aturan)) {
    const el = form.elements[name];
    const msg = cek(el.value.trim());
    $(`.err[data-for="${name}"]`).textContent = msg;
    el.classList.toggle("invalid", !!msg);
    if (msg) ok = false;
  }
  return ok;
}

function checkout(e) {
  e.preventDefault();
  if (cart.length === 0) return toast("Keranjang masih kosong.");
  const form = e.target;
  if (!validasi(form)) return;

  const { subtotal, ppn, total } = hitung();
  const data = {
    nomor: nomorBaru(),
    tanggal: new Date().toISOString(),
    pembeli: {
      nama: form.nama.value.trim(),
      hp: form.hp.value.trim(),
      alamat: form.alamat.value.trim(),
    },
    metode: form.metode.value,
    items: cart.map((c) => {
      const p = produkById(c.id);
      return { nama: p.nama, harga: p.harga, qty: c.qty };
    }),
    subtotal, ppn, total,
  };

  const riwayat = baca(KEY_RIWAYAT, []);
  riwayat.unshift(data);
  simpan(KEY_RIWAYAT, riwayat);

  cart = [];
  form.reset();
  renderCart();
  renderRiwayat();
  bukaKwitansi(data);
}

// ---------- Kwitansi ----------
function bukaKwitansi(k) {
  kwitansiAktif = k;
  const perluMeterai = k.total > BATAS_METERAI;
  $("#kwitansi").innerHTML = `
    <div class="kw-stamp">LUNAS</div>
    <div class="kw-head">
      <div>
        <h3>KWITANSI</h3>
        <div class="kw-shop"><strong>${esc(TOKO.nama)}</strong><br>${esc(TOKO.alamat)} · Telp ${esc(TOKO.telp)}</div>
      </div>
      <div class="kw-meta">
        <strong>No. ${esc(k.nomor)}</strong>
        ${esc(tglIndo(k.tanggal))}<br>Pembayaran: ${esc(k.metode)}
      </div>
    </div>

    <div class="kw-row"><div class="k">Telah terima dari</div><div class="v">${esc(k.pembeli.nama)} (${esc(k.pembeli.hp)})</div></div>
    <div class="kw-row"><div class="k">Alamat</div><div class="v">${esc(k.pembeli.alamat)}</div></div>
    <div class="kw-row"><div class="k">Uang sejumlah</div><div class="v kw-terbilang">${esc(terbilangRupiah(k.total))}</div></div>
    <div class="kw-row"><div class="k">Untuk pembayaran</div><div class="v">Pembelian barang sebagai berikut:</div></div>

    <table class="kw-items">
      <thead><tr><th>Barang</th><th class="num">Harga</th><th class="num">Qty</th><th class="num">Jumlah</th></tr></thead>
      <tbody>
        ${k.items.map((i) => `
          <tr><td>${esc(i.nama)}</td><td class="num">${rupiah(i.harga)}</td><td class="num">${i.qty}</td><td class="num">${rupiah(i.harga * i.qty)}</td></tr>`).join("")}
      </tbody>
      <tfoot>
        <tr><td colspan="3" class="num">Subtotal</td><td class="num">${rupiah(k.subtotal)}</td></tr>
        <tr><td colspan="3" class="num">PPN ${PPN * 100}%</td><td class="num">${rupiah(k.ppn)}</td></tr>
        <tr class="grand"><td colspan="3" class="num">Total</td><td class="num">${rupiah(k.total)}</td></tr>
      </tfoot>
    </table>

    <div class="kw-foot">
      <div class="kw-total">${rupiah(k.total)}</div>
      <div class="kw-sign">
        Surabaya, ${esc(new Date(k.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }))}<br>Penerima,
        ${perluMeterai ? `<div class="meterai">METERAI<br>Rp10.000</div>` : `<div class="gap"></div>`}
        <div class="who">${esc(TOKO.kasir)}</div>
      </div>
    </div>`;
  const dlg = $("#kwitansiDialog");
  if (!dlg.open) dlg.showModal();
}

// ---------- Riwayat ----------
function renderRiwayat() {
  const data = baca(KEY_RIWAYAT, []);
  $("#badgeRiwayat").textContent = data.length;
  $("#historyEmpty").hidden = data.length > 0;
  $("#btnClear").disabled = data.length === 0;
  $("#historyBody").innerHTML = data.map((k, i) => `
    <tr>
      <td>${esc(k.nomor)}</td>
      <td>${esc(tglIndo(k.tanggal))}</td>
      <td>${esc(k.pembeli.nama)}</td>
      <td>${esc(k.metode)}</td>
      <td class="num">${rupiah(k.total)}</td>
      <td><button class="btn" data-lihat="${i}">Lihat</button></td>
    </tr>`).join("");
}

// ---------- Navigasi tab ----------
function gantiView(nama) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === nama));
  $("#view-belanja").hidden = nama !== "belanja";
  $("#view-riwayat").hidden = nama !== "riwayat";
}

// ---------- Event ----------
document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.add) { ubahQty(+t.dataset.add, 1); toast("Ditambahkan ke keranjang"); }
  else if (t.dataset.inc) ubahQty(+t.dataset.inc, 1);
  else if (t.dataset.dec) ubahQty(+t.dataset.dec, -1);
  else if (t.dataset.view) gantiView(t.dataset.view);
  else if (t.dataset.lihat) bukaKwitansi(baca(KEY_RIWAYAT, [])[+t.dataset.lihat]);
});

$("#search").addEventListener("input", renderProduk);
$("#checkoutForm").addEventListener("submit", checkout);
$("#btnPrint").addEventListener("click", () => window.print());
$("#btnClose").addEventListener("click", () => $("#kwitansiDialog").close());
$("#kwitansiDialog").addEventListener("click", (e) => { if (e.target.id === "kwitansiDialog") e.target.close(); });
$("#btnClear").addEventListener("click", () => {
  if (confirm("Hapus semua riwayat kwitansi? Nomor kwitansi akan mulai dari 0001 lagi.")) {
    localStorage.removeItem(KEY_RIWAYAT);
    localStorage.removeItem(KEY_COUNTER);
    renderRiwayat();
    toast("Riwayat dihapus");
  }
});

// ---------- Mulai ----------
renderProduk();
renderCart();
renderRiwayat();
