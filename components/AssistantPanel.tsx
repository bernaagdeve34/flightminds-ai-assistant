"use client";

import React from "react";

interface Props {
	language: "tr" | "en";
}

export default function AssistantPanel({ language }: Props) {
	const [listening, setListening] = React.useState(false);
	const [transcript, setTranscript] = React.useState("");
	const [answer, setAnswer] = React.useState<string>("");
	const [input, setInput] = React.useState<string>("");

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
			alert(language === "tr" ? "Tarayıcınız konuşma tanımayı desteklemiyor." : "Your browser does not support speech recognition.");
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

	return (
		<div className="bg-white border rounded-lg shadow-sm p-4 flex flex-col gap-3">
			<div className="font-medium">
				{language === "tr" ? "AI Asistanı" : "AI Assistant"}
			</div>
			<button
				onClick={startListening}
				className={`px-4 py-2 rounded text-white ${listening ? "bg-red-600" : "bg-blue-600"}`}
			>
				{listening ? (language === "tr" ? "Dinleniyor..." : "Listening...") : (language === "tr" ? "Mikrofona tıkla" : "Tap microphone")}
			</button>
			{transcript && (
				<div className="text-sm text-gray-700">
					{language === "tr" ? "Soru:" : "Query:"} {transcript}
				</div>
			)}
			<div className="flex gap-2 pt-1">
				<input
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder={language === "tr" ? "Soru yazın" : "Type a query"}
					className="border rounded px-2 py-1 flex-1"
				/>
				<button
					onClick={() => input && sendQuery(input)}
					className="px-3 py-1 rounded bg-gray-800 text-white"
				>
					{language === "tr" ? "Gönder" : "Send"}
				</button>
			</div>
			{answer && (
				<div className="text-sm text-gray-900 whitespace-pre-wrap border-t pt-2">
					{answer}
				</div>
			)}
		</div>
	);
}


