import React from "react";
import { Flight } from "@/lib/types";
import { formatTimeLocal } from "@/lib/utils";

interface Props {
	title: string;
	flights: Flight[];
}

export default function FlightTable({ title, flights }: Props) {
	return (
		<div className="bg-white border rounded-lg shadow-sm overflow-hidden">
			<div className="px-4 py-2 bg-gray-50 border-b font-medium">{title}</div>
			<div className="overflow-x-auto">
				<table className="min-w-full text-sm">
					<thead>
						<tr className="bg-gray-50 text-left text-gray-600">
							<th className="px-3 py-2">Uçuş</th>
							<th className="px-3 py-2">Havayolu</th>
							<th className="px-3 py-2">Şehir</th>
							<th className="px-3 py-2">Planlanan</th>
							<th className="px-3 py-2">Tahmini</th>
							<th className="px-3 py-2">Durum</th>
						</tr>
					</thead>
					<tbody>
						{flights.map((f) => (
							<tr key={f.id} className="border-t">
								<td className="px-3 py-2 font-medium">{f.flightNumber}</td>
								<td className="px-3 py-2">{f.airline}</td>
								<td className="px-3 py-2">
									{f.direction === "Arrival" ? f.originCity : f.destinationCity}
								</td>
								<td className="px-3 py-2">{formatTimeLocal(f.scheduledTimeLocal)}</td>
								<td className="px-3 py-2">{formatTimeLocal(f.estimatedTimeLocal ?? f.scheduledTimeLocal)}</td>
								<td className="px-3 py-2">{f.status}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}


