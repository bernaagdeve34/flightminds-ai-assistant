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

	const startListening = React.useCallback(() => {
		const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
		if (!SpeechRecognition) {
			alert(t.browserNoSupport);
			return;
		}
		const recognition = new SpeechRecognition();
		recognition.lang = language === "tr" ? "tr-TR" : "en-US";
		recognition.interimResults = false;
		recognition.maxAlternatives = 1;
		setListening(true);
		recognition.onresult = async (event: any) => {
			const text = event.results[0][0].transcript as string;
			setTranscript(text);
			setListening(false);
			// Send to backend (Gemini/local) for parsing and answer
			sendQuery(text);
		};
		recognition.onerror = () => setListening(false);
		recognition.onend = () => setListening(false);
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

	React.useEffect(() => {
		if (speakEnabled && answer) {
			speak(answer);
		}
	}, [answer, speakEnabled, speak]);

	return (
		<div className="relative bg-gradient-to-br from-indigo-600/60 via-purple-600/60 to-fuchsia-600/60 rounded-3xl p-8 text-white shadow-xl min-h-[420px] flex flex-col items-center justify-center gap-6">
			<div className="text-center">
				<div className="text-2xl font-semibold">{t.heroTitle}</div>
				<div className="opacity-90 mt-1">{t.heroSubtitle}</div>
			</div>
			<button
				onClick={startListening}
				className={`h-28 w-28 rounded-full flex items-center justify-center shadow-lg transition-transform ${listening ? "bg-rose-500 scale-105" : "bg-white text-purple-700"}`}
				title={listening ? t.listening : t.micStart}
			>
				<svg
					width="48"
					height="48"
					viewBox="0 0 24 24"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
					className={`${listening ? "text-white" : "text-purple-700"}`}
				>
					<path d="M12 14c1.654 0 3-1.346 3-3V6c0-1.654-1.346-3-3-3S9 4.346 9 6v5c0 1.654 1.346 3 3 3z" fill="currentColor"/>
					<path d="M19 11a1 1 0 10-2 0 5 5 0 11-10 0 1 1 0 10-2 0 7 7 0 0012 0z" fill="currentColor"/>
					<path d="M11 19.938V22h2v-2.062A7.01 7.01 0 0012 20c-.34 0-.674-.022-1-.062z" fill="currentColor"/>
				</svg>
			</button>
			<div className="w-full max-w-xl bg-white/15 backdrop-blur-md rounded-2xl p-3">
				<div className="flex gap-2">
					<input
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder={t.inputPlaceholder}
						className="flex-1 rounded-lg px-3 py-2 bg-white/80 text-gray-900 placeholder-gray-500 focus:outline-none"
					/>
					<button
						onClick={() => input && sendQuery(input)}
						className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-black"
					>
						{t.send}
					</button>
				</div>
				<div className="flex items-center justify-between mt-2">
					<button
						onClick={() => setSpeakEnabled((v) => !v)}
						className={`text-xs px-3 py-1.5 rounded-full border ${speakEnabled ? "bg-white/80 text-gray-900" : "bg-white/20 text-white"}`}
						title={t.tts.speakToggle}
					>
						{t.tts.speakToggle}
					</button>
					{speaking && (
						<button onClick={stopSpeak} className="text-xs px-3 py-1.5 rounded-full bg-rose-500 text-white">
							{t.tts.stop}
						</button>
					)}
				</div>
				{transcript && (
					<div className="text-sm text-white/90 mt-2">{t.queryLabel} {transcript}</div>
				)}
			</div>
			<div className="flex flex-wrap gap-2 justify-center">
				{t.samplePrompts.map((p, i) => (
					<button key={i} onClick={() => setInput(p)} className="text-xs px-3 py-1.5 rounded-full bg-white/20 hover:bg-white/25 backdrop-blur border border-white/30">
						{p}
					</button>
				))}
			</div>
			{answer && (
				<div className="text-sm text-white/95 whitespace-pre-wrap border-t border-white/20 pt-3 w-full max-w-xl">
					{answer}
				</div>
			)}
		</div>
	);
}


