import { describe, expect, it } from 'vitest';
import { attachmentKind, kindLabel, openHelp, type AttachmentKind } from './attachment-kinds';

describe('attachmentKind', () => {
  it('recognises Word content types', () => {
    expect(attachmentKind('report.bin', 'application/msword')).toBe('word');
    expect(attachmentKind('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('word');
    expect(attachmentKind('template.dotx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.template')).toBe('word');
  });

  it('recognises Excel content types', () => {
    expect(attachmentKind('sheet.bin', 'application/vnd.ms-excel')).toBe('excel');
    expect(attachmentKind('sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('excel');
  });

  it('recognises PowerPoint content types', () => {
    expect(attachmentKind('deck.bin', 'application/vnd.ms-powerpoint')).toBe('powerpoint');
    expect(attachmentKind('deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('powerpoint');
  });

  it('recognises PDF', () => {
    expect(attachmentKind('doc.pdf', 'application/pdf')).toBe('pdf');
  });

  it('recognises Google Docs family content types', () => {
    expect(attachmentKind('doc', 'application/vnd.google-apps.document')).toBe('google-doc');
    expect(attachmentKind('sheet', 'application/vnd.google-apps.spreadsheet')).toBe('google-sheet');
    expect(attachmentKind('slides', 'application/vnd.google-apps.presentation')).toBe('google-slides');
  });

  it('recognises calendar invites', () => {
    expect(attachmentKind('invite.ics', 'text/calendar')).toBe('calendar');
  });

  it('recognises common media and archive types', () => {
    expect(attachmentKind('photo.png', 'image/png')).toBe('image');
    expect(attachmentKind('song.mp3', 'audio/mpeg')).toBe('audio');
    expect(attachmentKind('clip.mp4', 'video/mp4')).toBe('video');
    expect(attachmentKind('bundle.zip', 'application/zip')).toBe('archive');
  });

  it('treats CSV as text, not a spreadsheet', () => {
    expect(attachmentKind('export.csv', 'text/csv')).toBe('text');
  });

  it('recognises plain text', () => {
    expect(attachmentKind('notes.txt', 'text/plain')).toBe('text');
  });

  it('strips content-type parameters before matching', () => {
    expect(attachmentKind('doc.pdf', 'application/pdf; charset=binary')).toBe('pdf');
  });

  it('is case-insensitive on the content type', () => {
    expect(attachmentKind('doc.pdf', 'APPLICATION/PDF')).toBe('pdf');
  });

  it('prefers a recognised content type over a conflicting extension', () => {
    expect(attachmentKind('fake.docx', 'application/pdf')).toBe('pdf');
  });

  it('falls back to the filename extension for application/octet-stream', () => {
    expect(attachmentKind('report.docx', 'application/octet-stream')).toBe('word');
    expect(attachmentKind('sheet.xlsx', 'application/octet-stream')).toBe('excel');
    expect(attachmentKind('deck.pptx', 'application/octet-stream')).toBe('powerpoint');
    expect(attachmentKind('archive.zip', 'application/octet-stream')).toBe('archive');
    expect(attachmentKind('invite.ics', 'application/octet-stream')).toBe('calendar');
    expect(attachmentKind('doc.gdoc', 'application/octet-stream')).toBe('google-doc');
    expect(attachmentKind('sheet.gsheet', 'application/octet-stream')).toBe('google-sheet');
    expect(attachmentKind('slides.gslides', 'application/octet-stream')).toBe('google-slides');
  });

  it('falls back to the filename extension when the content type is missing', () => {
    expect(attachmentKind('sheet.xlsx', null)).toBe('excel');
    expect(attachmentKind('notes.csv', undefined)).toBe('text');
    expect(attachmentKind('notes.csv', '')).toBe('text');
  });

  it('falls back to the filename extension when the content type is unrecognised', () => {
    expect(attachmentKind('report.docx', 'application/x-mystery-type')).toBe('word');
  });

  it('matches extensions case-insensitively', () => {
    expect(attachmentKind('photo.HEIC', 'application/octet-stream')).toBe('image');
  });

  it('returns other when nothing matches', () => {
    expect(attachmentKind('mystery.xyz', 'application/octet-stream')).toBe('other');
    expect(attachmentKind('README', 'application/octet-stream')).toBe('other');
    expect(attachmentKind(null, null)).toBe('other');
    expect(attachmentKind('', '')).toBe('other');
  });
});

describe('kindLabel', () => {
  const expected: Record<AttachmentKind, string> = {
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

  for (const [kind, label] of Object.entries(expected)) {
    it(`labels ${kind} as "${label}"`, () => {
      expect(kindLabel(kind as AttachmentKind)).toBe(label);
    });
  }
});

describe('openHelp', () => {
  it('points Android readers to the free Microsoft app for Office kinds', () => {
    expect(openHelp('word', 'android')).toEqual({
      text: 'Opens in Microsoft Word — free from Google Play',
      href: 'https://play.google.com/store/apps/details?id=com.microsoft.office.word',
    });
    expect(openHelp('excel', 'android')).toEqual({
      text: 'Opens in Microsoft Excel — free from Google Play',
      href: 'https://play.google.com/store/apps/details?id=com.microsoft.office.excel',
    });
    expect(openHelp('powerpoint', 'android')).toEqual({
      text: 'Opens in Microsoft PowerPoint — free from Google Play',
      href: 'https://play.google.com/store/apps/details?id=com.microsoft.office.powerpoint',
    });
  });

  it('gives no Office hint off Android', () => {
    expect(openHelp('word', 'other')).toBeNull();
    expect(openHelp('excel', 'other')).toBeNull();
    expect(openHelp('powerpoint', 'other')).toBeNull();
  });

  it('explains Google Docs family files on any platform, with no link', () => {
    for (const kind of ['google-doc', 'google-sheet', 'google-slides'] as const) {
      expect(openHelp(kind, 'android')).toEqual({
        text: 'This is a Google Docs file — it opens in your browser with a Google account',
      });
      expect(openHelp(kind, 'other')).toEqual({
        text: 'This is a Google Docs file — it opens in your browser with a Google account',
      });
      expect(openHelp(kind, 'android')?.href).toBeUndefined();
    }
  });

  it('has nothing to add for kinds without a special hint', () => {
    expect(openHelp('pdf', 'android')).toBeNull();
    expect(openHelp('image', 'android')).toBeNull();
    expect(openHelp('calendar', 'android')).toBeNull();
    expect(openHelp('archive', 'other')).toBeNull();
    expect(openHelp('other', 'android')).toBeNull();
  });
});
