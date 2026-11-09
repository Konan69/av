# Configuration

av reads environment variables. Set them in the shell that runs the command.

| Variable | Default | Read by | What it does |
| --- | --- | --- | --- |
| `VITE_GENOME_URL` | empty | `npm start`, `npm run build`, `npm run nw:setup` | The base URL of the deployed analyzer. The client posts to `$VITE_GENOME_URL/analyze`. When it is empty, a new track fails with `no analyzer configured: set VITE_GENOME_URL`. `nw:setup` also adds its origin to the desktop sandbox's `connect-src`. |
| `NW_WRLD_PROJECT_DIR` | `nw/project` | the web server, `nw:setup`, `nw:start` | The workspace: dashboard configuration, module edits and `assets/`. Setup copies missing defaults from `nw/template/` and never overwrites existing JSON. |
| `NW_WRLD_USER_DATA_DIR` | `.runtime/profile` | `nw:start` | The Electron profile of the optional desktop route. |
| `DJ_ORGANIZER_URL` | `http://127.0.0.1:8765` | the web server | The dj-organizer server behind `/api/dj/`. |
| `TRACKS_DIR` | `~/Music/Tracks` | `npm run legacy:player` | The folder the legacy player lists at `/api/tracks`. |
| `CDP` | `http://localhost:9334` | `scripts/recorder-window.mjs` | The Chrome remote debugging endpoint for visual recordings. |
| `GENOME_API_KEY` | unset | the Modal analyzer | When set in the container, `POST /analyze` requires a matching `x-api-key` header. |

The workspace in `nw/project/` and the recordings in `artifacts/visual-tests/` are ignored by Git.
