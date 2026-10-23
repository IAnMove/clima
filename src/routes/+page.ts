import type { PageLoad } from './$types';
import { homeSeo } from '$lib/seo';

export const prerender = true;

export const load: PageLoad = () => {
	return { seo: homeSeo };
};
