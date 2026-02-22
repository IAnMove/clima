export interface Municipality {
	code: string;
	name: string;
	province: string | null;
	latitude: number | null;
	longitude: number | null;
}

export interface ProvinceMunicipalities {
	province: string;
	totalMunicipalities: number;
	municipalities: Municipality[];
}
