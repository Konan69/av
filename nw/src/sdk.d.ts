/** nw_wrld injects these bindings from the module's metadata header. */
declare const ModuleBase: {
  new (container: HTMLElement): {
    elem: HTMLElement | null;
    show(options?: {duration?: number}): void;
    hide(options?: {duration?: number}): void;
    destroy(): void;
  };
  methods: unknown[];
};
declare const assetUrl: (path: string) => string | null;
