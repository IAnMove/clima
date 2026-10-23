import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			precompress: true
		}),
		prerender: {
			origin: 'https://clima.iaen.es',
			crawl: false,
			entries: ['/']
		}
	}
};

export default config;
