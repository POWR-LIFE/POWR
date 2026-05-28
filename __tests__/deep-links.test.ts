import { redirectSystemPath } from '@/app/+native-intent';

// redirectSystemPath maps incoming OS deep links (powr://...) to in-app routes.
// new URL() throws on custom schemes in Hermes, so this is pure string parsing.
function redirect(path: string) {
  return redirectSystemPath({ path, initial: true });
}

describe('redirectSystemPath', () => {
  it('passes plain route paths straight through', () => {
    expect(redirect('/(tabs)/index')).toBe('/(tabs)/index');
    expect(redirect('/whoop-callback?code=X')).toBe('/whoop-callback?code=X');
  });

  it('maps powr://host?query to /host?query', () => {
    expect(redirect('powr://whoop-callback?code=X')).toBe('/whoop-callback?code=X');
    expect(redirect('powr://fitbit-callback?code=abc&state=y')).toBe(
      '/fitbit-callback?code=abc&state=y',
    );
  });

  it('maps powr://host/path?query preserving the path', () => {
    expect(redirect('powr://gym/check-in?id=42')).toBe('/gym/check-in?id=42');
  });

  // auth-callback carries the OAuth code and is handled by the Linking listener,
  // so it must NOT navigate — it returns root.
  it('routes auth-callback to root so the OAuth listener handles it', () => {
    expect(redirect('powr://auth-callback?code=X')).toBe('/');
  });

  it('treats empty and bare-scheme inputs as root', () => {
    expect(redirect('')).toBe('/');
    expect(redirect('/')).toBe('/');
    expect(redirect('powr://')).toBe('/');
    expect(redirect('powr:///')).toBe('/');
  });
});
