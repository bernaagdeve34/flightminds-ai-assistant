"use client";

import React from "react";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { i18n } from "@/lib/i18n";

interface Props {
  language: "tr" | "en";
  scope?: "domestic" | "international";
}

export default function AssistantPanel({ language, scope }: Props) {
  const [listening, setListening] = React.useState(false);
  const [transcript, setTranscript] = React.useState("");
  const [answer, setAnswer] = React.useState<string>("");
  const [input, setInput] = React.useState<string>("");
  const [speakEnabled, setSpeakEnabled] = React.useState(true);
  const [speaking, setSpeaking] = React.useState(false);
  const t = i18n[language];
  const synthRef = React.useRef<SpeechSynthesis | null>(null);
  const mediaRecRef = React.useRef<MediaRecorder | null>(null);
  const silenceTimerRef = React.useRef<any>(null);

  // TTS helpers (önce tanımla ki aşağıda kullanılabilsin)
  const stopSpeak = React.useCallback(() => {
    const synth = synthRef.current ?? (typeof window !== "undefined" ? window.speechSynthesis : null);
    if (synth && synth.speaking) {
      synth.cancel();
      setSpeaking(false);
    }
  }, []);

  const speak = React.useCallback((text: string) => {
    const synth = synthRef.current ?? (typeof window !== "undefined" ? window.speechSynthesis : null);
    if (!synth) return;
    try {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = language === "tr" ? "tr-TR" : "en-US";
      utter.rate = 1;
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => setSpeaking(false);
      synth.cancel();
      setSpeaking(true);
      synth.speak(utter);
    } catch {
      setSpeaking(false);
    }
  }, [language]);

  const sendQuery = React.useCallback(async (text: string) => {
    try {
      // metinle gönderildiğinde alt tarafta soru olarak göster
      setTranscript(text);
      const resp = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, lang: language, scope, debug: true }),
      });
      const data = await resp.json();
      try { console.log("ASSISTANT RESPONSE", data); } catch {}
      const ans = String(data?.answer ?? "");
      setAnswer(ans);
      if (ans && speakEnabled) {
        try { stopSpeak(); } catch {}
        speak(ans);
      }
    } catch {
      setAnswer("");
    }
  }, [language, scope, speakEnabled, speak, stopSpeak]);

  // Whisper tabanlı kayıt (tercih edilen)
  const startWhisperRecording = React.useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      mediaRecRef.current = rec;
      const chunks: BlobPart[] = [];
      setListening(true);
      let maxTimer: any = null;
      const stopDueToSilence = () => { try { rec.stop(); } catch {} };
      // Tek handler: chunk geldikçe biriktir ve sessizlik sayacını yenile
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(stopDueToSilence, 1400);
        }
      };
      rec.onstop = async () => {
        setListening(false);
        try {
          const blob = new Blob(chunks, { type: mime });
          const ab = await blob.arrayBuffer();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
          const stt = await fetch('/api/stt/whisper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioBase64: base64, mimeType: mime, lang: language })
          });
          const data = await stt.json();
          const text = typeof data?.transcript === 'string' ? data.transcript : '';
          const ok = data?.ok !== false;
          setTranscript(text);
          if (ok && text) {
            await sendQuery(text);
          } else {
            startWebSpeech();
          }
        } catch {
          // Fallback: Web Speech'e dön
          startWebSpeech();
        } finally {
          if (maxTimer) clearTimeout(maxTimer);
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          try { stream.getTracks().forEach(t => t.stop()); } catch {}
        }
      };
      rec.start(100);
      // Üst sınır: 4.5s sonra mutlaka durdur
      maxTimer = setTimeout(() => { try { rec.stop(); } catch {} }, 4500);
    } catch {
      // Mic izni veya MediaRecorder yoksa Web Speech'e düş
      startWebSpeech();
    }
  }, [language, sendQuery]);

  // Azure Speech (tek seferlik) — öncelikli yol
  const startAzureRecognition = React.useCallback(async () => {
    try {
      setListening(true);
      // Token al
      const r = await fetch("/api/azure/speech/token", { method: "POST" });
      const j = await r.json();
      if (!j?.ok || !j?.token || !j?.region) {
        // Azure yoksa Web Speech'e düş
        setListening(false);
        startWebSpeech();
        return;
      }

      const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(j.token, j.region);
      speechConfig.speechRecognitionLanguage = language === "tr" ? "tr-TR" : "en-US";
      const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
      const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

      await new Promise<void>((resolve) => {
        recognizer.recognizeOnceAsync(async (result: sdk.SpeechRecognitionResult) => {
          try {
            const text = String(result?.text || "").trim();
            setTranscript(text);
            if (text) await sendQuery(text);
          } finally {
            recognizer.close();
            resolve();
          }
        });
      });
    } catch {
      // Azure başarısızsa Web Speech'e düş
      setListening(false);
      startWebSpeech();
    } finally {
      // listening state Web Speech içinde yönetilecek
    }
  }, [language, sendQuery, startWhisperRecording]);

  // Web Speech fallback
  const startWebSpeech = React.useCallback(() => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      alert(t.browserNoSupport);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = language === "tr" ? "tr-TR" : "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;
    setListening(true);
    let finalText = "";
    let silenceTimer: any = null;
    const stopDueToSilence = () => {
      try { recognition.stop(); } catch {}
    };
    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          finalText += (finalText ? " " : "") + res[0].transcript;
        } else {
          interim += res[0].transcript;
        }
      }
      setTranscript(finalText || interim);
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(stopDueToSilence, 1200); // ~1.2s sessizlikte dur
    };
    recognition.onerror = () => {
      setListening(false);
    };
    recognition.onend = async () => {
      setListening(false);
      const textToSend = (finalText || transcript).trim();
      if (textToSend) {
        sendQuery(textToSend);
      }
    };
    recognition.start();
  }, [language]);


  React.useEffect(() => {
    synthRef.current = typeof window !== "undefined" ? window.speechSynthesis : null;
  }, []);

  return (
    <div
      className="relative rounded-3xl p-6 text-white shadow-2xl min-h-[420px] w-full max-w-xl mx-auto flex flex-col items-center justify-center gap-5"
      style={{
        background: "linear-gradient(135deg, rgba(0,179,164,0.85) 0%, rgba(0,198,215,0.85) 100%)",
      }}
    >
      <div className="text-center">
        <div className="text-2xl font-semibold tracking-wide">{t.heroTitle}</div>
        <div className="opacity-90 mt-1 text-base">{t.heroSubtitle}</div>
      </div>
      <button
        onClick={startWebSpeech}
        className={`relative h-32 w-32 rounded-full flex items-center justify-center shadow-2xl transition-all border overflow-hidden ${
          listening ? "ring-4 ring-white/70 scale-105" : "bg-white hover:scale-105"
        }`}
        title={listening ? t.listening : t.micStart}
        style={listening ? { background: "var(--ist-teal)" } : { borderColor: "rgba(0,0,0,0.05)" }}
      >
        <div className="absolute inset-0 p-8" style={{ animation: 'kaskotFloat 3.8s ease-in-out infinite' }}>
          <img
            src="/kaskot.png"
            alt={t.micStart}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              objectPosition: '50% 50%',
              transform: 'translateX(0px) scale(0.94)',
              filter: listening ? 'brightness(0) invert(1)' : 'none'
            }}
          />
        </div>
        <span
          className={`absolute bottom-4 right-4 h-10 w-10 rounded-full flex items-center justify-center text-white shadow-md ${
            listening ? "bg-rose-500 animate-pulse" : "bg-emerald-500"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
            <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3zm5-3a5 5 0 1 1-10 0H5a7 7 0 0 0 6 6.92V20H9v2h6v-2h-2v-2.08A7 7 0 0 0 19 11h-2z"/>
          </svg>
        </span>
      </button>
      <style jsx>{`
        @keyframes kaskotFloat {
          0% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-2px) rotate(-0.6deg); }
          50% { transform: translateY(0) rotate(0deg); }
          75% { transform: translateY(2px) rotate(0.6deg); }
          100% { transform: translateY(0) rotate(0deg); }
        }
      `}</style>
      <div className="w-full max-w-lg bg-white/15 backdrop-blur-md rounded-2xl p-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t.inputPlaceholder}
            className="flex-1 rounded-lg px-3 py-2 bg-white/85 text-gray-900 placeholder-gray-500 focus:outline-none text-base"
          />
          <button
            onClick={() => input && sendQuery(input)}
            className="px-4 py-2 rounded-lg text-white text-sm"
            style={{ background: "linear-gradient(90deg, var(--ist-teal), var(--ist-cyan))" }}
          >
            {t.send}
          </button>
        </div>
        {speaking && (
          <div className="flex justify-end mt-1.5">
            <button onClick={stopSpeak} className="text-xs px-2.5 py-1 rounded-full bg-rose-500 text-white">
              {t.tts.stop}
            </button>
          </div>
        )}
				{transcript && (
					<div className="text-xs text-white/90 mt-1.5">{t.queryLabel} {transcript}</div>
				)}
			</div>
			<div className="flex flex-wrap gap-2.5 justify-center">
				{t.samplePrompts.map((p, i) => (
					<button key={i} onClick={() => setInput(p)} className="text-xs px-2.5 py-1 rounded-full bg-white/20 hover:bg-white/25 backdrop-blur border border-white/30">
						{p}
					</button>
				))}
			</div>
			{answer && (
				<div className="text-sm text-white/95 whitespace-pre-wrap border-t border-white/20 pt-3 w-full max-w-lg">
					{answer}
				</div>
			)}
		</div>
	);
}
