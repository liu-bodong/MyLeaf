/**
 * Compile times on a paper with figures, with the image options of
 * CompileOptions: none, `reuseImages` (converted copies of slow PNGs) and
 * `draftImages` (boxes instead of images). The figures are generated: three
 * matplotlib-like plots (2400 x 1800 PNGs with an alpha channel, which
 * pdfTeX decodes and compresses again on every compile), an opaque PNG
 * screenshot and a vector PDF scatter plot (both copied as they are).
 * Run after building: `pnpm bench:images`. Set BENCH_RUNS to change repetitions.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { TexLiveCompileBackend } from '@myleaf/compile-texlive';
import type { CompileOptions, CompileResult } from '@myleaf/compile';
import { ProjectId } from '@myleaf/doc-model';
import { parseProjectPath } from '@myleaf/project';
import type { ProjectFile } from '@myleaf/project';

const RUNS = Number(process.env.BENCH_RUNS ?? 5);

function png(
  width: number,
  height: number,
  alpha: boolean,
  pixel: (x: number, y: number) => number[],
) {
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0, at = 0; y < height; y++) {
    raw[at++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const value = pixel(x, y);
      for (let c = 0; c < channels; c++) raw[at++] = value[c] ?? 255;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = alpha ? 6 : 2; // RGBA or RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A line plot on a white background with grid lines, like matplotlib's. */
const plot = (seed: number) =>
  png(2400, 1800, true, (x, y) => {
    for (let k = 0; k < 5; k++) {
      const curve = 900 + 500 * Math.sin(x / (150 + 40 * k) + k + seed) * Math.cos(x / 900);
      if (Math.abs(y - curve) < 3) return [40 * k, 100, 255 - 40 * k, 255];
    }
    return y % 100 < 2 ? [220, 220, 220, 255] : [255, 255, 255, 255];
  });

/** A noisy gradient, like a screenshot or photo saved as PNG. */
let noise = 1;
const screenshot = () =>
  png(2400, 1600, false, (x) => {
    noise = (noise * 1103515245 + 12345) % 2147483648;
    const v = Math.floor(x / 12) + (noise % 40);
    return [v, v, v];
  });

/** A one-page PDF with many small squares. */
function scatter(points: number): Buffer {
  let state = 7;
  const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
  const ops = Array.from(
    { length: points },
    () => `${(random() * 400 + 20).toFixed(2)} ${(random() * 280 + 20).toFixed(2)} 1.5 1.5 re f`,
  );
  const stream = deflateSync(`0.2 0.3 0.8 rg\n${ops.join('\n')}`);
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 440 320] /Contents 4 0 R >>'),
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`),
      stream,
      Buffer.from('\nendstream'),
    ]),
  ];
  const parts = [Buffer.from('%PDF-1.5\n')];
  const offsets: number[] = [];
  let length = parts[0]!.length;
  objects.forEach((object, i) => {
    offsets.push(length);
    const part = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ]);
    parts.push(part);
    length += part.length;
  });
  const xref = [
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
  ].join('');
  return Buffer.concat([...parts, Buffer.from(xref)]);
}

const FIGURES: Record<string, Buffer> = {
  'plot1.png': plot(0),
  'screenshot.png': screenshot(),
  'plot2.png': plot(1),
  'scatter.pdf': scatter(40_000),
  'plot3.png': plot(2),
};

const filler = 'This paragraph of filler text makes the benchmark document realistic. '.repeat(12);
const body = Object.keys(FIGURES)
  .map(
    (name, i) => String.raw`\section{Section ${i + 1}}
${filler}

${filler}

\begin{figure}[t]\centering
\includegraphics[width=0.9\linewidth]{${name}}
\caption{Figure ${i + 1}.}\label{fig:${i}}
\end{figure}
See Figure~\ref{fig:${i}}. ${filler}
`,
  )
  .join('\n');
const paper = String.raw`\documentclass{article}
\usepackage{graphicx}
\usepackage{hyperref}
\begin{document}
${body}
\end{document}
`;

const encode = (text: string) => new TextEncoder().encode(text);
const files = (source: string): ProjectFile[] => [
  { path: parseProjectPath('main.tex'), content: encode(source) },
  ...Object.entries(FIGURES).map(([name, content]) => ({
    path: parseProjectPath(name),
    content: new Uint8Array(content),
  })),
];
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

async function scenario(workRoot: string, label: string, options: Partial<CompileOptions>) {
  const backend = new TexLiveCompileBackend({ workRoot });
  const projectId = ProjectId(`bench-${label}`);
  const compile = async (source: string, singlePass: boolean): Promise<CompileResult> => {
    const result = await backend.compile({
      projectId,
      rootFile: parseProjectPath('main.tex'),
      engine: 'pdflatex',
      files: files(source),
      options: { precompilePreamble: true, singlePass, ...options },
    });
    if (!result.hasPdf) throw new Error(`Benchmark compile failed:\n${result.log.slice(-2000)}`);
    return result;
  };
  const first = (await compile(paper, false)).durationMs;
  await backend.imagesConverted();
  await compile(paper, false); // after the preamble is precompiled and images converted
  const timings: Record<string, number> = { 'First compile': first };
  for (const singlePass of [false, true]) {
    const durations: number[] = [];
    for (let i = 1; i <= RUNS; i++) {
      const edited = paper.replace('filler text', `filler text ${singlePass ? 's' : 'f'}${i}`);
      durations.push((await compile(edited, singlePass)).durationMs);
    }
    timings[singlePass ? 'Text edit, auto-compile (single pass)' : 'Text edit, Recompile'] =
      median(durations);
  }
  return timings;
}

const workRoot = await mkdtemp(join(tmpdir(), 'myleaf-image-bench-'));
try {
  const columns = {
    'No image options': await scenario(workRoot, 'none', {}),
    'Reuse images': await scenario(workRoot, 'reuse', { reuseImages: true }),
    'Draft images': await scenario(workRoot, 'draft', { draftImages: true }),
  };
  const version = execFileSync('pdflatex', ['--version'], { encoding: 'utf8' }).split('\n')[0];
  console.log(`${version}\nMedian of ${RUNS} runs (ms), precompiled preamble, compile only.\n`);
  console.log(`| Scenario | ${Object.keys(columns).join(' | ')} |`);
  console.log(`| --- |${' ---: |'.repeat(Object.keys(columns).length)}`);
  for (const row of Object.keys(columns['No image options'])) {
    const cells = Object.values(columns).map((timings) => timings[row]);
    console.log(`| ${row} | ${cells.join(' | ')} |`);
  }
} finally {
  await rm(workRoot, { recursive: true, force: true });
}
