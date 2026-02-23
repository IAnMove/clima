import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { execSync } from 'child_process';

function resolveBuildCommit(): string {
	try {
		const commit = execSync('git rev-parse --short HEAD', {
			stdio: ['ignore', 'pipe', 'ignore']
		})
			.toString()
			.trim();
		return commit || 'dev';
	} catch {
		return 'dev';
	}
}

export default defineConfig({
	plugins: [sveltekit()],
	define: {
		__BUILD_COMMIT__: JSON.stringify(resolveBuildCommit())
	}
});
