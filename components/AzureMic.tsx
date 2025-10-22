"use client";
import * as React from "react";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";

export default function AzureMic() {
  const [listening, setListening] = React.useState(false);
  const [text, setText] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);

  async function recognizeOnceTr() {
    try {
      setErr(null);
      setText("");
      setListening(true);

      const r = await fetch("/api/azure/speech/token", { method: "POST" });
      const j = await r.json();
      if (!j?.ok || !j?.token || !j?.region) {
        setErr("Azure token alınamadı.");
        setListening(false);
        return;
      }

      const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(j.token, j.region);
      speechConfig.speechRecognitionLanguage = "tr-TR";
      const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
      const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

      await new Promise<void>((resolve) => {
        recognizer.recognizeOnceAsync((result) => {
          try {
            setText(result?.text || "");
          } finally {
            recognizer.close();
            resolve();
          }
        });
      });
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setListening(false);
    }
  }

  return (
    <div className="p-4 rounded-xl border bg-white/90 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">Mikrofondan Dinle (Azure STT · tr-TR)</div>
        <button
          onClick={recognizeOnceTr}
          disabled={listening}
          className={`px-3 py-1.5 text-sm rounded-full text-white ${listening ? "bg-gray-400" : "bg-teal-600 hover:bg-teal-700"}`}
        >
          {listening ? "Dinleniyor..." : "Dinlemeyi Başlat"}
        </button>
      </div>
      {text && (
        <div className="mt-3 text-sm text-gray-800">
          <span className="font-semibold">Metin:</span> {text}
        </div>
      )}
      {err && (
        <div className="mt-3 text-sm text-red-600">
          Hata: {err}
        </div>
      )}
    </div>
  );
}
