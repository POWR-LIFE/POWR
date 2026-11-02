import {
  applyMerge,
  findEmbeddedImages,
  GMAIL_CLIP_BYTES,
  listMergeTags,
  lockImageOnlyBlocks,
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

describe('lockImageOnlyBlocks (Gmail dark mode)', () => {
  const lock = (c: string) => `background-image:linear-gradient(${c},${c})`;

  test('locks a coloured block that holds only an image', () => {
    const html = '<table><tr><td bgcolor="#080808" style="background-color:#080808;padding:36px;"><img src="https://x/logo.png" alt="POWR" height="48"></td></tr></table>';
    const out = lockImageOnlyBlocks(html);
    expect(out).toContain(`style="background-color:#080808;padding:36px;${lock('#080808')}"`);
    // nothing else changed
    expect(out.replace(`${lock('#080808')}`, '')).toBe(html);
  });

  test('adds a style when the block only has a bgcolor attribute, and takes rgb() colours', () => {
    expect(lockImageOnlyBlocks('<td bgcolor="#14161A"><img src="a.png" width="80"></td>'))
      .toBe(`<td style="${lock('#14161A')}" bgcolor="#14161A"><img src="a.png" width="80"></td>`);
    expect(lockImageOnlyBlocks('<div style="background:rgb(20, 22, 26)"><a href="x"><img src="a.png"></a></div>'))
      .toContain(lock('rgb(20, 22, 26)'));
  });

  test('never locks a block with text, however small', () => {
    const withText = '<td bgcolor="#14161A"><img src="a.png"><p>Open POWR</p></td>';
    expect(lockImageOnlyBlocks(withText)).toBe(withText);
    const nbsp = '<td bgcolor="#14161A"><img src="a.png">&nbsp;</td>';
    expect(lockImageOnlyBlocks(nbsp)).toBe(nbsp);
    const link = '<td bgcolor="#14161A"><a href="x"><img src="a.png"> Shop</a></td>';
    expect(lockImageOnlyBlocks(link)).toBe(link);
  });

  test('leaves spacer cells, tracking pixels and imageless blocks alone', () => {
    for (const html of [
      '<td bgcolor="#ffffff" height="20"></td>',
      '<td bgcolor="#ffffff"><img src="spacer.gif" width="1" height="20"></td>',
      '<td bgcolor="#ffffff"><img src="t.gif" style="width:1px;height:1px"></td>',
      '<td bgcolor="#080808"><br></td>',
    ]) expect(lockImageOnlyBlocks(html)).toBe(html);
  });

  test('leaves blocks that already paint an image or have no solid colour', () => {
    for (const html of [
      '<td style="background:url(x.png) #000"><img src="a.png"></td>',
      `<td style="${lock('#000')}"><img src="a.png"></td>`,
      '<td background="x.png" bgcolor="#000"><img src="a.png"></td>',
      '<td style="background:transparent" bgcolor="#000"><img src="a.png"></td>',
      '<td style="background:#000 no-repeat"><img src="a.png"></td>',
      '<td style="color:red"><img src="a.png"></td>',
      '<td bgcolor="black"><img src="a.png"></td>',
    ]) expect(lockImageOnlyBlocks(html)).toBe(html);
  });

  test('locks the image-only block inside a block that has text, not the outer one', () => {
    const html = '<table bgcolor="#080808"><tr><td bgcolor="#080808"><img src="logo.png" height="40"></td></tr><tr><td bgcolor="#080808"><p>Words</p></td></tr></table>';
    const out = lockImageOnlyBlocks(html);
    expect(out.match(/linear-gradient/g)).toHaveLength(1);   // the image-only cell only
    expect(out).toContain(`<td style="${lock('#080808')}" bgcolor="#080808"><img`);
    expect(out).toContain('<table bgcolor="#080808">');
    expect(out).toContain('<td bgcolor="#080808"><p>Words</p>');
  });

  test('is idempotent', () => {
    const once = lockImageOnlyBlocks('<td bgcolor="#080808"><img src="a.png"></td>');
    expect(lockImageOnlyBlocks(once)).toBe(once);
  });

  test('ignores text inside comments, style and script, and survives odd markup', () => {
    const html = '<td bgcolor="#080808"><!--[if mso]>Outlook text<![endif]--><style>.a{color:red}</style><img src="a.png"></td>';
    expect(lockImageOnlyBlocks(html)).toContain(lock('#080808'));
    // quotes containing ">" in attributes do not end the tag early
    expect(lockImageOnlyBlocks('<td bgcolor="#080808" title="a > b"><img src="a.png" alt="x > y"></td>')).toContain(lock('#080808'));
  });

  test('gives up, returning the input, on malformed or badly nested markup', () => {
    for (const html of [
      '<td bgcolor="#080808"><img src="a.png"',                     // unterminated tag
      '<td bgcolor="#080808"><!-- never closed <img src="a.png"></td>',
      '<td bgcolor="#080808"><style>.a{}</td>',
      '<td bgcolor="#080808"><div><img src="a.png"></td>',          // </td> implicitly closes the div
      '',
      'plain text, no markup',
    ]) expect(lockImageOnlyBlocks(html)).toBe(html);
  });

  test('the POWR shell: the logo band is locked, the card and footer are not', () => {
    const out = renderAdminEmail(
      { subject: 'S', preheader: 'P', html: '<p>Hello</p>', text: '', use_shell: true },
      jamie,
    ).html;
    expect(out.match(/background-image:linear-gradient\(#080808,#080808\)/g)).toHaveLength(1);
    expect(out).toMatch(/<td class="sec" bgcolor="#080808" style="background-color:#080808;padding:36px 40px 32px;text-align:center;border-bottom:1px solid #161616;background-image:linear-gradient\(#080808,#080808\)">\s*<img/);
    // body row and footer carry text, so they keep no lock
    expect(out).toContain('<td class="sec" bgcolor="#050505" style="background-color:#050505;padding:30px 40px;text-align:center;">');
  });

  test('a pasted full document: only its text-free blocks are locked', () => {
    const doc = '<!doctype html><html><head><style>td{margin:0}</style></head><body style="background:#14161A"><table><tr><td style="background:#14161A;padding:24px"><img src="https://x/p.png" width="78"></td></tr><tr><td style="background:#14161A"><h1 style="color:#F1E8DC">Something is moving.</h1></td></tr></table></body></html>';
    const out = renderAdminEmail({ subject: 'S', preheader: '', html: doc, text: '', use_shell: false }, jamie).html;
    expect(out.match(/linear-gradient/g)).toHaveLength(1);   // the logo cell; the headline cell has text
    expect(out).toContain(`padding:24px;${lock('#14161A')}"><img`);
    expect(out).toContain('<td style="background:#14161A"><h1');
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
