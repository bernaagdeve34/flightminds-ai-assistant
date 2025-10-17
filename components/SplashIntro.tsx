"use client";

import React from "react";

interface Props {
	language: "tr" | "en";
	durationMs?: number;
	onDone?: () => void;
}

export default function SplashIntro({ language, durationMs = 2200, onDone }: Props) {
	const [visible, setVisible] = React.useState(true);

	React.useEffect(() => {
		const t = setTimeout(() => {
			setVisible(false);
			onDone?.();
		}, durationMs);
		return () => clearTimeout(t);
	}, [durationMs, onDone]);

	if (!visible) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-600 text-white">
			<div className="flex flex-col items-center gap-6">
				<div className="text-center">
					<div className="text-2xl font-semibold mb-2">
						{language === "tr" ? "Başlatılıyor" : "Initializing"}
					</div>
					<div className="text-sm opacity-90">
						{language === "tr" ? "Konuşma tanıma hazırlanıyor..." : "Preparing speech recognition..."}
					</div>
				</div>
				<div className="flex gap-2">
					<span className="w-2 h-2 rounded-full bg-white/90 animate-bounce [animation-delay:-0.3s]"></span>
					<span className="w-2 h-2 rounded-full bg-white/90 animate-bounce [animation-delay:-0.15s]"></span>
					<span className="w-2 h-2 rounded-full bg-white/90 animate-bounce"></span>
				</div>
			</div>
		</div>
	);
}


