import {
  applyMerge,
  findEmbeddedImages,
  GMAIL_CLIP_BYTES,
  listMergeTags,
  mergeVarsFor,
  renderAdminEmail,
  SAMPLE_VARS,
  sizeWarnings,
  stripScripts,
  unknownMergeTags,
} from '../supabase/functions/_shared/emails/admin-template';

const jamie = mergeVarsFor({
  email: 'jamie@powr.life',
  display_name: 'Jamie Wright',
  username: 'jamie',
  referral_code: 'JAMIE8',
  balance: 1240,
});

describe('admin email template merge', () => {
  test('merge values come from the recipient row', () => {
    expect(jamie.first_name).toBe('Jamie');
    expect(jamie.name).toBe('Jamie Wright');
    expect(jamie.balance).toBe('1,240');
    expect(jamie.email).toBe('jamie@powr.life');
  });

  test('a recipient with no display name is addressed as "there"', () => {
    const vars = mergeVarsFor({ email: 'x@y.z', display_name: '   ' });
    expect(vars.first_name).toBe('there');
    expect(vars.name).toBe('there');
    expect(vars.username).toBe('');
    expect(vars.balance).toBe('0');
  });

  test('known tags are filled, with HTML escaping only in html mode', () => {
    const vars = { ...jamie, name: 'Tom & "Jerry" <3' };
    expect(applyMerge('Hi {{ first_name }}, you have {{balance}} POWR', vars, 'text'))
      .toBe('Hi Jamie, you have 1,240 POWR');
    expect(applyMerge('<b>{{name}}</b>', vars, 'html'))
      .toBe('<b>Tom &amp; &quot;Jerry&quot; &lt;3</b>');
    expect(applyMerge('{{name}}', vars, 'text')).toBe('Tom & "Jerry" <3');
  });

  test('unknown tags are left as written and reported', () => {
    const src = 'Hey {{first_name}}, your {{points}} and {{ gym_name }} {{first_name}}';
    expect(applyMerge(src, jamie, 'text')).toBe('Hey Jamie, your {{points}} and {{ gym_name }} Jamie');
    expect(listMergeTags(src)).toEqual(['first_name', 'points', 'gym_name']);
    expect(unknownMergeTags(src)).toEqual(['points', 'gym_name']);
  });

  test('sample vars cover every tag', () => {
    for (const key of Object.keys(jamie)) expect(SAMPLE_VARS[key as keyof typeof SAMPLE_VARS]).toBeTruthy();
  });
});

describe('stripScripts', () => {
  test('removes script blocks, nested openers and an unclosed tail', () => {
    expect(stripScripts('<p>a</p><script>alert(1)</script><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(stripScripts('<p>a</p><SCRIPT type="x">x</SCRIPT ><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(stripScripts('<p>a</p><scr<script></script>ipt>evil()</script><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(stripScripts('<p>a</p><script>never closed')).toBe('<p>a</p>');
  });

  test('accepts the closers browsers accept, and only real script tags', () => {
    expect(stripScripts('<p>a</p><script>x</script\t\n bar><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(stripScripts('<p>a</p><script src=x></script/><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(stripScripts('<p>a</p><ScRiPt\n>x</SCRIPT\r\n><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(stripScripts('<p>a</p><script>x</scripts><p>b</p>')).toBe('<p>a</p>');
    expect(stripScripts('<scripts>keep</scripts><p>a</p>')).toBe('<scripts>keep</scripts><p>a</p>');
    expect(stripScripts('<p>a</p><script>b<script>c</script>d')).toBe('<p>a</p>d');
  });

  test('leaves ordinary HTML alone', () => {
    const html = '<table><tr><td style="color:#fff">{{first_name}}</td></tr></table>';
    expect(stripScripts(html)).toBe(html);
  });
});

describe('renderAdminEmail', () => {
  const template = {
    subject: 'Hey {{first_name}}',
    preheader: '{{balance}} POWR waiting',
    html: '<p>Hi {{name}}</p><script>alert(1)</script>',
    text: 'Hi {{name}}',
    use_shell: true,
  };

  test('a fragment is wrapped in the POWR shell with preheader and unsubscribe', () => {
    const out = renderAdminEmail(template, jamie, 'en');
    expect(out.subject).toBe('Hey Jamie');
    expect(out.html).toContain('<!DOCTYPE html>');
    expect(out.html).toContain('1,240 POWR waiting');
    expect(out.html).toContain('<p>Hi Jamie Wright</p>');
    expect(out.html).toContain('%unsubscribe_url%');
    expect(out.html).not.toContain('<script');
    expect(out.text).toBe('Hi Jamie Wright');
  });

  test('a full document goes out as written, minus scripts', () => {
    const html = '<html><body><h1>{{first_name}}</h1><script>x()</script></body></html>';
    const out = renderAdminEmail({ ...template, html, use_shell: false }, jamie);
    expect(out.html).toBe('<html><body><h1>Jamie</h1></body></html>');
  });

  test('the shell footer follows the recipient language', () => {
    const en = renderAdminEmail(template, jamie, 'en').html;
    const fr = renderAdminEmail(template, jamie, 'fr').html;
    expect(fr).toContain('<html lang="fr">');
    expect(fr).not.toBe(en);
  });
});

describe('embedded images and size', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';

  test('finds unique data URIs in img src and CSS url()', () => {
    const html = `<img src="${png}"><div style="background:url(${png})"></div><img src="data:image/jpeg;base64,/9j/4AAQ">`;
    const images = findEmbeddedImages(html);
    expect(images.map((i) => i.mime)).toEqual(['image/png', 'image/jpeg']);
    expect(images[0].bytes).toBe(8);
    expect(images[0].uri).toBe(png);
  });

  test('plain HTML has no size warnings', () => {
    expect(sizeWarnings('<p>hi</p>', '<p>hi</p>')).toEqual([]);
  });

  test('warns about base64 images and Gmail clipping', () => {
    const warnings = sizeWarnings(`<img src="${png}">`, 'x'.repeat(GMAIL_CLIP_BYTES + 1));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('1 image embedded as base64');
    expect(warnings[1]).toContain('Gmail clips');
  });
});
