"use client";

import React from "react";
import { i18n } from "@/lib/i18n";

interface Props {
  language: "tr" | "en";
}

export default function AssistantPanel({ language }: Props) {
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

  const sendQuery = React.useCallback(async (text: string) => {
    try {
      const resp = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, lang: language }),
      });
      const data = await resp.json();
      setAnswer(data.answer ?? "");
    } catch {
      setAnswer("");
    }
  }, [language]);

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
          const text = String(data?.transcript || '');
          setTranscript(text);
          if (text) await sendQuery(text);
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

  React.useEffect(() => {
    synthRef.current = typeof window !== "undefined" ? window.speechSynthesis : null;
  }, []);

  return (
    <div
      className="relative rounded-3xl p-4 text-white shadow-xl min-h-[320px] flex flex-col items-center justify-center gap-4"
      style={{
        background: "linear-gradient(135deg, rgba(0,179,164,0.85) 0%, rgba(0,198,215,0.85) 100%)",
      }}
    >
      <div className="text-center">
        <div className="text-xl font-semibold">{t.heroTitle}</div>
        <div className="opacity-90 mt-0.5 text-sm">{t.heroSubtitle}</div>
      </div>
      <button
        onClick={startWhisperRecording}
        className={`h-16 w-16 rounded-full flex items-center justify-center shadow-lg transition-transform border ${
          listening ? "scale-105" : "bg-white"
        }`}
        title={listening ? t.listening : t.micStart}
        style={listening ? { background: "var(--ist-teal)" } : { borderColor: "rgba(0,0,0,0.05)" }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={listening ? "text-white" : ""}
          style={listening ? undefined : { color: "var(--ist-teal)" }}
        >
          <path d="M12 14c1.654 0 3-1.346 3-3V6c0-1.654-1.346-3-3-3S9 4.346 9 6v5c0 1.654 1.346 3 3 3z" fill="currentColor"/>
          <path d="M19 11a1 1 0 10-2 0 5 5 0 11-10 0 1 1 0 10-2 0 7 7 0 0012 0z" fill="currentColor"/>
          <path d="M11 19.938V22h2v-2.062A7.01 7.01 0 0012 20c-.34 0-.674-.022-1-.062z" fill="currentColor"/>
        </svg>
      </button>
      <div className="w-full max-w-md bg-white/15 backdrop-blur-md rounded-2xl p-2.5">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t.inputPlaceholder}
            className="flex-1 rounded-lg px-3 py-1.5 bg-white/80 text-gray-900 placeholder-gray-500 focus:outline-none text-sm"
          />
          <button
            onClick={() => input && sendQuery(input)}
            className="px-3 py-1.5 rounded-lg text-white text-sm"
            style={{ background: "linear-gradient(90deg, var(--ist-teal), var(--ist-cyan))" }}
          >
            {t.send}
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5">
					<button
						onClick={() => setSpeakEnabled((v) => !v)}
						className={`text-xs px-2.5 py-1 rounded-full border ${speakEnabled ? "bg-white/80 text-gray-900" : "bg-white/20 text-white"}`}
						title={t.tts.speakToggle}
					>
						{t.tts.speakToggle}
					</button>
					{speaking && (
						<button onClick={stopSpeak} className="text-xs px-2.5 py-1 rounded-full bg-rose-500 text-white">
							{t.tts.stop}
						</button>
					)}
				</div>
				{transcript && (
					<div className="text-xs text-white/90 mt-1.5">{t.queryLabel} {transcript}</div>
				)}
			</div>
			<div className="flex flex-wrap gap-2 justify-center">
				{t.samplePrompts.map((p, i) => (
					<button key={i} onClick={() => setInput(p)} className="text-xs px-2.5 py-1 rounded-full bg-white/20 hover:bg-white/25 backdrop-blur border border-white/30">
						{p}
					</button>
				))}
			</div>
			{answer && (
				<div className="text-sm text-white/95 whitespace-pre-wrap border-t border-white/20 pt-2 w-full max-w-md">
					{answer}
				</div>
			)}
		</div>
	);
}


