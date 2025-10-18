"use client";

import React from "react";
import { i18n } from "@/lib/i18n";

interface Props {
	language: "tr" | "en";
	durationMs?: number;
	onDone?: () => void;
}

export default function SplashIntro({ language, durationMs = 6000, onDone }: Props) {
	const [visible, setVisible] = React.useState(true);
    const t = i18n[language];

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
				<div className="flex flex-col items-center gap-3">
					<div className="h-16 w-16">
						<svg viewBox="0 0 24 24" className="h-16 w-16 text-white/95 [animation:plane-fly_2.6s_ease-in-out_infinite]">
							<path fill="currentColor" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9L2 14v2l8-2.5V18l-2 1.5V21l3-1 3 1v-1.5L13 18v-4.5z"/>
						</svg>
					</div>
					<div className="flex gap-2">
						<span className="w-2 h-2 rounded-full bg-white/70 animate-bounce [animation-delay:-0.45s]"></span>
						<span className="w-2 h-2 rounded-full bg-white/70 animate-bounce [animation-delay:-0.3s]"></span>
						<span className="w-2 h-2 rounded-full bg-white/70 animate-bounce [animation-delay:-0.15s]"></span>
						<span className="w-2 h-2 rounded-full bg-white/70 animate-bounce"></span>
					</div>
					<div className="text-center">
						<div className="text-2xl font-semibold mb-1">{t.splash.redirectTitle}</div>
						<div className="text-sm opacity-90">{t.splash.redirectSubtitle}</div>
					</div>
					<div className="w-64 h-1.5 bg-white/30 rounded-full overflow-hidden">
						<div className="h-full w-1/3 bg-white [animation:progress_1.8s_ease-in-out_infinite]"></div>
					</div>
				</div>
			</div>
			<style jsx>{`
			@keyframes plane-fly { 0% { transform: translateX(-8px) rotate(-6deg); } 50% { transform: translateX(0) rotate(0deg);} 100% { transform: translateX(8px) rotate(6deg);} }
			@keyframes progress { 0% { transform: translateX(-120%);} 50% { transform: translateX(0);} 100% { transform: translateX(120%);} }
			`}</style>
		</div>
	);
}


