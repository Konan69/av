import { createReadStream, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Your music folder, served to the player so you never drag a file again. */
const TRACKS_DIR = process.env.TRACKS_DIR ?? "~/Music/Tracks";
const AUDIO = /\.(m4a|mp3|wav|flac|ogg|aac|aiff?)$/i;

function tracksFolder(): Plugin {
	return {
		name: "tracks-folder",
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				const url = req.url ?? "";
				if (url === "/api/tracks") {
					try {
						const names = (await readdir(TRACKS_DIR)).filter((n) => AUDIO.test(n)).sort();
						const list = names.map((name) => ({ name, size: statSync(join(TRACKS_DIR, name)).size }));
						res.setHeader("content-type", "application/json");
						res.end(JSON.stringify(list));
					} catch {
						res.setHeader("content-type", "application/json");
						res.end("[]");
					}
					return;
				}
				if (url.startsWith("/api/tracks/")) {
					const name = decodeURIComponent(url.slice("/api/tracks/".length));
					if (name.includes("/") || name.includes("..") || !AUDIO.test(name)) {
						res.statusCode = 400;
						res.end("bad name");
						return;
					}
					const path = join(TRACKS_DIR, name);
					try {
						const st = statSync(path);
						res.setHeader("content-length", String(st.size));
						res.setHeader("content-type", "application/octet-stream");
						createReadStream(path).pipe(res);
					} catch {
						res.statusCode = 404;
						res.end("not found");
					}
					return;
				}
				next();
			});
		},
	};
}

export default defineConfig({
	plugins: [react(), tracksFolder()],
	server: { host: true },
});
