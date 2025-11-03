export async function groqChatSmart({ question, facts, language = "tr" }: { question: string; facts: string; language?: "tr" | "en" }) {
  try {
    const key = process.env.GROQ_API_KEY;
    const enabled = String(process.env.GROQ_ENABLED || "false").toLowerCase() === "true";
    if (!enabled || !key) return "";
    const envModel = (process.env.GROQ_MODEL || "").trim();
    const modelCandidates = [
      envModel,
      // Current production models (Groq docs)
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      // Older/backup ids in case account still has them
      "llama-3.1-70b",
      "llama-3.1-8b",
      "mixtral-8x7b-32768",
    ].filter(Boolean);

    const context = `
İstanbul Havalimanı (IST), Türkiye’nin en büyük uluslararası havalimanıdır.
Hem iç hat hem de dış hat uçuşları bulunur.
Terminal 1 genellikle dış hatlar, iç hatlar terminali ise yurt içi seferler için kullanılır.
Havalimanında restoranlar, mağazalar, ibadet alanları (mescit), çocuk oyun alanları, lounge hizmetleri, otopark, taksi, Havaist otobüsleri ve duty free mağazaları mevcuttur.
`;

    const systemPrompt =
      language === "tr"
        ? `Sen İstanbul Havalimanı'nda görev yapan bir sanal asistansın.
Kullanıcının sorduğu her soruya İstanbul Havalimanı bağlamında net, doğru ve güvenilir cevaplar ver.
Öncelikle aşağıdaki verilere (FAQ_VERİLERİ) dayan.
Eğer verilerde doğrudan bilgi yoksa, İstanbul Havalimanı hakkında genel bilgini kullanarak mantıklı bir yanıt oluştur.
Cevaplarını kısa, doğal ve kullanıcı dostu yaz.
ÖNEMLİ: Cevabı kesinlikle TÜRKÇE ver.`
        : `You are a virtual assistant working at Istanbul Airport.
Answer all user questions accurately and clearly based on the information below.
If not directly found in the FAQ_DATA, rely on your general knowledge about Istanbul Airport to give a reasonable answer.
Keep answers concise and natural.
IMPORTANT: Always respond in ENGLISH.`;

    let lastError = "";
    for (const model of modelCandidates) {
      try {
        const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            temperature: 0.3,
            max_tokens: 512,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `${question}\n\nFAQ_VERİLERİ:\n${facts}\n\nGENEL_BİLGİLER:\n${context}` },
            ],
          }),
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          lastError = `HTTP ${resp.status} ${resp.statusText} ${txt.slice(0,200)}`;
          console.error(" Groq HTTP error (model=", model, "):", lastError);
          // continue to next model if model is decommissioned/invalid
          if (txt.includes("model") && (txt.includes("decommissioned") || txt.includes("not found") || txt.includes("invalid"))) {
            continue;
          }
          // other HTTP errors: stop
          return "";
        }
        const j = await resp.json().catch((e) => {
          console.error(" Groq JSON parse error (model=", model, "):", e);
          return null;
        });
        const out = j?.choices?.[0]?.message?.content?.trim();
        if (out) return out;
        console.warn(" Groq boş çıktı (model=", model, "):", JSON.stringify(j).slice(0, 300));
        // try next model
      } catch (e) {
        console.error(" Groq call exception (model=", model, "):", e);
        lastError = String(e);
      }
    }
    // all attempts failed
    if (lastError) console.error(" Groq all models failed:", lastError);
    return "";
  } catch (e) {
    console.error(" Groq call exception:", e);
    return "";
  }
}
