import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import EmailHtmlFrame from './EmailHtmlFrame.svelte';
import MessageBody from './MessageBody.svelte';

describe('message body frame', () => {
  it('server-renders without inline event handlers that the CSP would block', () => {
    const { body } = render(EmailHtmlFrame, { props: { html: '<p>Hello</p>', title: 'Email content' } });
    // An onload="this.__e=event" attribute is an inline script: the app CSP
    // has no 'unsafe-inline', so the browser drops it and the frame's load
    // event is lost before hydration.
    expect(body).not.toMatch(/\son(?:load|error)=/i);
    expect(body).toContain('srcdoc=');
    expect(body).toContain('&lt;p>Hello&lt;/p>');
  });

  it('renders a Sent copy body (bare text, <br>, signature block) inside the frame', () => {
    const sentHtml = 'Hello Bob<br>Second line<br><div><hr><p style="font-size:12px;color:#666">Sig</p></div>';
    const { body } = render(MessageBody, { props: { body: sentHtml, messageId: 'sent-1', allowRemoteImages: true } });
    expect(body).not.toContain('No message content');
    expect(body).toContain('Hello Bob&lt;br>Second line');
  });
});
