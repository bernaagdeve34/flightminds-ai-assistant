"use client";

import React from "react";

export type Lang = "tr" | "en";

interface LanguageSwitchProps {
	value: Lang;
	onChange: (lang: Lang) => void;
}

export default function LanguageSwitch({ value, onChange }: LanguageSwitchProps) {
	return (
		<div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
			<button
				type="button"
				className={`px-3 py-1 text-sm ${
					value === "tr" ? "bg-gray-900 text-white" : "bg-white text-gray-900"
				}`}
				onClick={() => onChange("tr")}
			>
				TR
			</button>
			<button
				type="button"
				className={`px-3 py-1 text-sm border-l border-gray-300 ${
					value === "en" ? "bg-gray-900 text-white" : "bg-white text-gray-900"
				}`}
				onClick={() => onChange("en")}
			>
				EN
			</button>
		</div>
	);
}


