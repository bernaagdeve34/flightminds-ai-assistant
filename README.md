## Istanbul Airport Flight Assistant

Next.js 15 tabanlı, İstanbul Havalimanı uçuş asistanı. Sesle/soruyla sorgulama yapar, canlı uçuş bilgisini gösterir ve SSS (RAG) üzerinden genel konuları yanıtlar.

---

## Hızlı Başlangıç (Lokal)

1) Bağımlılıklar

```bash
npm install
```

2) Ortam değişkenleri (.env.local)

```dotenv
# Lokal geliştirme için önerilir
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# Uçuş listesini "şu andan geriye" kaç dakika gösterelim? (varsayılan 60)
FLIGHT_LOOKBACK_MINUTES=60

# (Opsiyonel) SSS sayfası CSV kaynağı (Google Sheets export link)
# FAQ_SHEET_URL=https://docs.google.com/spreadsheets/.../export?format=csv&gid=0

# (Opsiyonel) RAG için Groq anahtarı; ilgili dosyada kullanıyorsanız ekleyin
# GROQ_API_KEY=...
```

3) Geliştirme sunucusu

```bash
npm run dev
```

Tarayıcı: http://localhost:3000

Mikrofon kullanımı için tarayıcıdan izin vermeyi unutmayın.

---

## Üretime Dağıtım (Vercel)

1) Environment Variable ayarları

- Production ortamında yalnızca şunu TANIMLAYIN:
  - `NEXT_PUBLIC_BASE_URL = https://flightminds-ai-assistant.vercel.app` (sonunda "/" yok)
- Preview ve Development ortamlarında BU DEĞİŞKENİ TANIMLAMAYIN (boş bırakın/siliniz).

2) Redeploy

- Değişiklikleri kaydettikten sonra Production için Redeploy yapın.

Not: Uygulama server tarafında internal API çağrıları yaparken `thisOrigin` olarak sırasıyla
`NEXT_PUBLIC_BASE_URL` → `VERCEL_URL` → istek `origin` değerlerini kullanır.

---

## Özellikler (Özet)

- Canlı Uçuş Bilgisi
  - İç/Dış hat verisi
  - Yön (Giden/Gelen) ve şehir eşleşmesi
  - 1 saat geri bakış penceresi (config: `FLIGHT_LOOKBACK_MINUTES`)
  - TR/EN statü çevirileri (örn. Kapı Kapandı → Gate Closed, Kontuar Açık → Check‑in Open)

- SSS (RAG)
  - CSV/Google Sheets kaynağı
  - TR/EN destekli yanıt üretimi
  - EN dilinde Türkçe renk adlarının otomatik çevirisi (ör. Kırmızı → Red)

- Önbellek (Cache)
  - RAM: 5 dk canlı uçuş cache
  - Disk: 30 dk fallback (Vercel prod: `/tmp` altında)

---

## Sık Karşılaşılan Sorular

- "Vercel Preview'da API yanlış domain'e gidiyor"
  - Preview/Development ortamlarında `NEXT_PUBLIC_BASE_URL` TANIMLAMAYIN.
  - Production'da doğru domain kullanın.

- "Google Fonts uyarısı görüyorum"
  - Ağ erişimi kısıtlıysa bu uyarı çıkabilir. Çalışmayı engellemez.
  - İsterseniz fontları `public/fonts` altına indirip `next/font/local` kullanabilirsiniz.

---

## Komutlar

```bash
# Geliştirme
npm run dev

# Üretim build
npm run build

# Üretim sunucusu (lokal test)
npm run start
```

---

## Lisans

Bu proje kurum içi kullanım içindir. Dış paylaşıma açılmadan önce lisans/depolama politikalarınızı uygulayınız.
