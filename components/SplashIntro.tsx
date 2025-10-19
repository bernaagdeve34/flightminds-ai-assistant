"use client";

import React from "react";
import { i18n } from "@/lib/i18n";
// Static import from project root (Next.js bundles it)

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
		<div className="fixed inset-0 z-50 flex items-center justify-center text-white" style={{
            background: "linear-gradient(135deg, var(--ist-teal) 0%, var(--ist-cyan) 100%)"
        }}>
			{/* Plane animation layer */}
			<div className="absolute top-24 left-0 right-0 pointer-events-none">
				<div className="mx-auto w-full max-w-4xl relative h-10">
					<svg viewBox="0 0 24 24" className="plane-anim absolute top-2 text-white/85 drop-shadow">
						<path fill="currentColor" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9L2 14v2l8-2.5V18l-2 1.5V21l3-1 3 1v-1.5L13 18v-4.5z"/>
					</svg>
				</div>
			</div>
			<div className="flex flex-col items-center gap-6">
				<div className="flex flex-col items-center gap-3">
					<div className="h-28 w-28 relative drop-shadow-lg">
						<img src="/ist_logo.png" alt="IST" className="h-28 w-28 object-contain" />
					</div>
					{/* Guidance icons row */}
					<div className="mt-1 flex items-center gap-4">
						<img
							src="/yonlendirme1.jpg"
							alt="guidance-1"
							className="h-12 w-12 rounded-md object-cover drop-shadow-lg opacity-95 guidance-float"
						/>
						<img
							src="/yonlendirme2.jpg"
							alt="guidance-2"
							className="h-12 w-12 rounded-md object-cover drop-shadow-lg opacity-95 guidance-float [animation-delay:0.6s]"
						/>
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
			@keyframes progress { 0% { transform: translateX(-120%);} 50% { transform: translateX(0);} 100% { transform: translateX(120%);} }
			@keyframes plane-loop { 0% { transform: translateX(-20vw) translateY(0) rotate(-6deg);} 50% { transform: translateX(0) translateY(-4px) rotate(0deg);} 100% { transform: translateX(20vw) translateY(0) rotate(6deg);} }
			@keyframes guidance-float { 0% { transform: translateY(0) rotate(-2deg);} 50% { transform: translateY(-6px) rotate(0);} 100% { transform: translateY(0) rotate(2deg);} }
			.plane-anim { width: 40px; height: 40px; left: 50%; transform: translateX(-50%); animation: plane-loop 3.2s ease-in-out infinite; }
			.guidance-float { animation: guidance-float 2.4s ease-in-out infinite; }
			`}</style>
		</div>
	);
}
