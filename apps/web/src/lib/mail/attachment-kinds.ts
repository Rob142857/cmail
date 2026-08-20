/**
 * The general category of a mail attachment. Used to pick a friendly label
 * and, for a few kinds, a short hint on how to open the file.
 */
export type AttachmentKind =
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'pdf'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'
  | 'text'
  | 'calendar'
  | 'google-doc'
  | 'google-sheet'
  | 'google-slides'
  | 'other';

/** A short, optional hint for opening an attachment, with an optional link. */
export interface AttachmentOpenHelp {
  text: string;
  href?: string;
}

// Checked in order against the normalised content type; the first match wins.
// Patterns are prefixes (no trailing `$`) so macro-enabled and template
// variants of the same format (e.g. `...wordprocessingml.template`) still
// match.
const CONTENT_TYPE_KINDS: Array<[RegExp, AttachmentKind]> = [
  [/^application\/vnd\.google-apps\.document$/, 'google-doc'],
  [/^application\/vnd\.google-apps\.spreadsheet$/, 'google-sheet'],
  [/^application\/vnd\.google-apps\.presentation$/, 'google-slides'],
  [/^application\/msword/, 'word'],
  [/^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\./, 'word'],
  [/^application\/vnd\.ms-excel/, 'excel'],
  [/^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\./, 'excel'],
  [/^application\/vnd\.ms-powerpoint/, 'powerpoint'],
  [/^application\/vnd\.openxmlformats-officedocument\.presentationml\./, 'powerpoint'],
  [/^application\/pdf$/, 'pdf'],
  [/^text\/calendar$/, 'calendar'],
  [/^application\/ics$/, 'calendar'],
  [/^text\/csv$/, 'text'],
  [/^application\/(zip|x-zip-compressed|x-rar-compressed|vnd\.rar|x-7z-compressed|x-tar|gzip|x-gzip)$/, 'archive'],
  [/^text\//, 'text'],
  [/^image\//, 'image'],
  [/^audio\//, 'audio'],
  [/^video\//, 'video'],
];

// Used only when the content type is missing or didn't match anything above
// (a bare `application/octet-stream` is the common case).
const EXTENSION_KINDS: Record<string, AttachmentKind> = {
  doc: 'word',
  docx: 'word',
  dot: 'word',
  dotx: 'word',
  xls: 'excel',
  xlsx: 'excel',
  xlsm: 'excel',
  csv: 'text',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  pdf: 'pdf',
  gdoc: 'google-doc',
  gsheet: 'google-sheet',
  gslides: 'google-slides',
  ics: 'calendar',
  txt: 'text',
  md: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  heic: 'image',
  heif: 'image',
  tif: 'image',
  tiff: 'image',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  aac: 'audio',
  flac: 'audio',
  mp4: 'video',
  mov: 'video',
  avi: 'video',
  mkv: 'video',
  webm: 'video',
  m4v: 'video',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
};

function normalizeContentType(contentType: string | null | undefined): string {
  if (!contentType) return '';
  // Strip parameters, e.g. `application/octet-stream; name=foo.docx`.
  return contentType.split(';')[0].trim().toLowerCase();
}

function extensionOf(filename: string | null | undefined): string {
  if (!filename) return '';
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * Classifies an attachment by its sender-declared content type, falling back
 * to the filename extension when the type is missing, unrecognised, or a
 * generic placeholder like `application/octet-stream`.
 */
export function attachmentKind(
  filename: string | null | undefined,
  contentType: string | null | undefined,
): AttachmentKind {
  const type = normalizeContentType(contentType);
  for (const [pattern, kind] of CONTENT_TYPE_KINDS) {
    if (pattern.test(type)) return kind;
  }
  const extension = extensionOf(filename);
  if (extension && extension in EXTENSION_KINDS) return EXTENSION_KINDS[extension];
  return 'other';
}

const KIND_LABELS: Record<AttachmentKind, string> = {
  word: 'Word document',
  excel: 'Excel spreadsheet',
  powerpoint: 'PowerPoint presentation',
  pdf: 'PDF',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  archive: 'Archive',
  text: 'Text file',
  calendar: 'Calendar invite',
  'google-doc': 'Google Doc',
  'google-sheet': 'Google Sheet',
  'google-slides': 'Google Slides',
  other: 'File',
};

/** A short, plain-language name for an attachment kind, e.g. next to a filename. */
export function kindLabel(kind: AttachmentKind): string {
  return KIND_LABELS[kind];
}

const GOOGLE_DOCS_HELP: AttachmentOpenHelp = {
  text: 'This is a Google Docs file — it opens in your browser with a Google account',
};

const ANDROID_OFFICE_HELP: Partial<Record<AttachmentKind, AttachmentOpenHelp>> = {
  word: {
    text: 'Opens in Microsoft Word — free from Google Play',
    href: 'https://play.google.com/store/apps/details?id=com.microsoft.office.word',
  },
  excel: {
    text: 'Opens in Microsoft Excel — free from Google Play',
    href: 'https://play.google.com/store/apps/details?id=com.microsoft.office.excel',
  },
  powerpoint: {
    text: 'Opens in Microsoft PowerPoint — free from Google Play',
    href: 'https://play.google.com/store/apps/details?id=com.microsoft.office.powerpoint',
  },
};

/**
 * A short, optional hint for opening an attachment, tailored to the viewer's
 * platform. Returns null when there's nothing useful to add.
 */
export function openHelp(kind: AttachmentKind, platform: 'android' | 'other'): AttachmentOpenHelp | null {
  if (kind === 'google-doc' || kind === 'google-sheet' || kind === 'google-slides') return GOOGLE_DOCS_HELP;
  if (platform === 'android') return ANDROID_OFFICE_HELP[kind] ?? null;
  return null;
}
