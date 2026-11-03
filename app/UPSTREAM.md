# Upstream source

This application starts from the complete source tree of [aagentah/nw_wrld](https://github.com/aagentah/nw_wrld), revision `a660a229d2413c48c3ca03bacf41421ff93e7836` (`0.7.0-beta`). The original GPL-3.0 license is retained in `LICENSE`.

The browser entry points reuse the upstream Dashboard, Projector, module sandbox, module base classes, composer, and starter modules. `web/` replaces Electron's preload IPC, BrowserView and local protocol handlers with browser messaging, an iframe, and a local workspace API. The original desktop sources remain available under `src/main`.

AV's analyzer/conductor and immersive scene are integrated through the `GenomeWorld` workspace module. Its source is maintained in `../nw/src` and `../player/src/world`; the module build injects the host's own Three.js instance.
