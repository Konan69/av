/** The visualizer on its own full-screen page: the same renderer, without the nw_wrld shell,
 * projector window or module sandbox around it. It only needs the two SDK bindings the module
 * was written against. */
class StandaloneModule {
  static methods: unknown[] = [];
  elem: HTMLElement | null;
  constructor(container: HTMLElement) { this.elem = container; }
  show() { if (this.elem) this.elem.style.opacity = '1'; }
  hide() { if (this.elem) this.elem.style.opacity = '0'; }
  destroy() { this.elem = null; }
}
const safe = (path: string) => /^[\w .()'&,+-]+(\/[\w .()'&,+-]+)*$/.test(path) && !path.split('/').includes('..');
Object.assign(globalThis, {
  ModuleBase: StandaloneModule,
  assetUrl: (path: string) => safe(path) ? `/api/nw/assets/${path.split('/').map(encodeURIComponent).join('/')}` : null,
});
const {default: GenomeWorld} = await import('../../nw/src/GenomeWorld');
const world = new GenomeWorld(document.getElementById('av')!);
const params = new URLSearchParams(location.search);
if (params.has('track')) world.loadDjTrack({id: Number(params.get('track')), name: params.get('name') || 'DJ library track'});
addEventListener('pagehide', () => world.destroy());
