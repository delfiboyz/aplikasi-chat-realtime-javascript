import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mentions, renderMarkdown } from '../public/js/format.js';
import { createTokenBucket } from '../src/lib/rateLimiter.js';

describe('renderMarkdown', () => {
  it('escapes HTML', () => {
    assert.equal(renderMarkdown('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  });

  it('formats bold, italic, strike and code', () => {
    assert.equal(
      renderMarkdown('**a** _b_ ~~c~~ `<d>`'),
      '<strong>a</strong> <em>b</em> <del>c</del> <code>&lt;d&gt;</code>',
    );
  });

  it('does not italicise snake_case words', () => {
    assert.equal(renderMarkdown('my_var_name'), 'my_var_name');
  });

  it('links only http(s) URLs and keeps them escaped', () => {
    const html = renderMarkdown('lihat https://example.com/?a=1&b="2" dan javascript:alert(1)');
    assert.match(html, /<a href="https:\/\/example.com\/\?a=1&amp;b=&quot;2" target="_blank" rel="noopener noreferrer">/);
    assert.doesNotMatch(html, /href="javascript/);
  });

  it('highlights mentions of the current user', () => {
    assert.match(renderMarkdown('hai @budi', 'budi'), /mention mention-me/);
    assert.ok(mentions('halo @Budi!', 'budi'));
    assert.ok(!mentions('email@budi.com', 'budi'));
  });
});

describe('createTokenBucket', () => {
  it('allows bursts up to capacity and refills over time', () => {
    let now = 0;
    const bucket = createTokenBucket({ capacity: 2, refillPerSec: 1, now: () => now });
    assert.ok(bucket.take());
    assert.ok(bucket.take());
    assert.ok(!bucket.take());
    now = 1000;
    assert.ok(bucket.take());
    assert.ok(!bucket.take());
  });
});
