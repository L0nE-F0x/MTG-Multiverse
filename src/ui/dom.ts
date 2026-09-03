/**
 * Tiny DOM helpers shared across UI modules. No framework, no dependencies —
 * just enough sugar to keep the component modules readable.
 */

export type Attrs = Record<string, string | number | boolean | undefined>;

export interface ElOptions {
  className?: string;
  text?: string;
  html?: string;
  attrs?: Attrs;
  style?: Partial<CSSStyleDeclaration>;
}

/**
 * Creates an element. The tag literal drives the return type, so
 * `el('input', ...)` already comes back typed as `HTMLInputElement` — no
 * cast needed at call sites.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.html !== undefined) node.innerHTML = opts.html;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v === undefined || v === false) continue;
      node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (opts.style) Object.assign(node.style, opts.style);
  for (const child of children) node.append(child);
  return node;
}

/** Debounces a function by `ms` milliseconds. Exposes `.cancel()` for cleanup. */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number,
): ((...args: Args) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: Args): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return wrapped;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

export function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** addEventListener that hands back its own cleanup function. */
export function listen(
  target: EventTarget,
  type: string,
  handler: (ev: Event) => void,
  opts?: boolean | AddEventListenerOptions,
): () => void {
  target.addEventListener(type, handler, opts);
  return () => target.removeEventListener(type, handler, opts);
}
