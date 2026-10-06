import type { ExportPaper } from '@thuluth/shared/contracts/export-pdf.ts';

/**
 * PDF renderer client (18 §2): the private Gotenberg 8 service on Cloud Run
 * (`tooling/gotenberg/`). Gotenberg runs with basic auth (`--api-enable-basic-auth`), username
 * `thuluth` and the password from Secret Manager; the function sends the same token from its
 * secret `GOTENBERG_TOKEN`. When `GOTENBERG_URL` or the token is unset the export path
 * answers FEATURE_DISABLED (renderer_not_configured) instead of failing on a network call.
 */

export interface RenderOptions {
  paper: ExportPaper;
  marginMm: number;
  title: string;
  lang: 'en' | 'ur';
}

export interface PdfRenderer {
  render(html: string, opts: RenderOptions): Promise<Uint8Array>;
}

export class RendererError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'RendererError';
  }
}

/** Paper sizes in inches (Gotenberg's units). */
const PAPER: Record<ExportPaper, { w: string; h: string }> = {
  A4: { w: '8.27', h: '11.7' },
  Letter: { w: '8.5', h: '11' },
};

export const RENDER_TIMEOUT_MS = 20_000;
export const GOTENBERG_USERNAME = 'thuluth';

export function gotenbergRenderer(cfg: {
  url: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): PdfRenderer {
  const doFetch = cfg.fetch ?? fetch;
  const base = cfg.url.replace(/\/+$/, '');
  return {
    async render(html, opts) {
      const form = new FormData();
      form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
      const inches = (mm: number) => (mm / 25.4).toFixed(3);
      const fields: Record<string, string> = {
        paperWidth: PAPER[opts.paper].w,
        paperHeight: PAPER[opts.paper].h,
        marginTop: inches(opts.marginMm),
        marginBottom: inches(opts.marginMm),
        marginLeft: inches(opts.marginMm),
        marginRight: inches(opts.marginMm),
        preferCssPageSize: 'false',
        printBackground: 'true',
        emulatedMediaType: 'print',
        waitDelay: '0s',
        failOnConsoleExceptions: 'true',
        metadata: JSON.stringify({ Title: opts.title, Author: 'Thuluth', Creator: 'Thuluth' }),
      };
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      const res = await doFetch(`${base}/forms/chromium/convert/html`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${btoa(`${GOTENBERG_USERNAME}:${cfg.token}`)}`,
          'gotenberg-output-filename': 'export',
        },
        body: form,
        signal: AbortSignal.timeout(cfg.timeoutMs ?? RENDER_TIMEOUT_MS),
      }).catch((err) => {
        throw new RendererError(`renderer unreachable: ${String(err)}`, null);
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new RendererError(`renderer returned ${res.status}`, res.status);
      }
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

/** The configured renderer, or null when the deployment has no PDF service yet. */
export function rendererFromEnv(): PdfRenderer | null {
  const url = Deno.env.get('GOTENBERG_URL');
  const token = Deno.env.get('GOTENBERG_TOKEN');
  if (!url || !token || !/^https:\/\//.test(url)) return null;
  return gotenbergRenderer({ url, token });
}

/** Page count from the PDF page tree (`/Type /Page` objects); at least 1. */
export function countPdfPages(pdf: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(pdf);
  const matches = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return Math.max(1, matches?.length ?? 0);
}
