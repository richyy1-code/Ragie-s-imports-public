const assert = require('node:assert/strict');
const test = require('node:test');
const { createRequire } = require('node:module');
const path = require('node:path');

const proxyRequire = createRequire(require.resolve('http-proxy-middleware'));
const sandboxRequire = createRequire(path.resolve(__dirname, '../../..', 'mockup-sandbox/package.json'));
const globRequire = createRequire(sandboxRequire.resolve('fast-glob'));

// Exercise both dependency chains so a lockfile change cannot silently leave one
// copy unpatched. No application routes, provider credentials or network needed.
for (const [consumer, consumerRequire] of [['proxy', proxyRequire], ['preview', globRequire]]) {
  const patternRequire = createRequire(consumerRequire.resolve('micromatch'));
  const braces = patternRequire('braces');
  const bracesRequire = createRequire(patternRequire.resolve('braces'));

  test(`${consumer}: ordinary patterns and consumer matching still work`, () => {
    assert.deepEqual(braces.expand('products/{red,blue}/{S,M}'), [
      'products/red/S', 'products/red/M', 'products/blue/S', 'products/blue/M',
    ]);
    assert.equal(typeof braces.compile('images/{1..5}'), 'string');
    assert.deepEqual(patternRequire('micromatch')(
      ['products/red/S', 'products/blue/M', 'orders/1'],
      'products/{red,blue}/*',
    ), ['products/red/S', 'products/blue/M']);
    assert.equal(braces.compile('('.repeat(32) + 'x' + ')'.repeat(32)).includes('x'), true);
  });

  test(`${consumer}: deep balanced and malformed strings fail safely`, { timeout: 3000 }, () => {
    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      for (const input of [
        open.repeat(5000) + 'a,b' + close.repeat(5000),
        open.repeat(5000) + 'a,b',
      ]) {
        for (const operation of ['parse', 'compile', 'expand', 'stringify', 'create']) {
          assert.throws(() => braces[operation](input), SyntaxError);
        }
        // A caller cannot disable the safety bound through ordinary options.
        assert.throws(() => braces.compile(input, { maxLength: Infinity }), SyntaxError);
      }
    }
  });

  test(`${consumer}: public and internal AST walkers reject deep and cyclic trees`, () => {
    const makeDeepTree = () => {
      const root = { type: 'root', nodes: [] };
      let node = root;
      for (let i = 0; i < 5000; i++) {
        const child = { type: 'paren', nodes: [] };
        node.nodes.push(child);
        node = child;
      }
      return root;
    };
    for (const operation of ['compile', 'expand', 'stringify']) {
      const internal = bracesRequire(`./lib/${operation}`);
      for (const walk of [braces[operation], internal]) {
        assert.throws(() => walk(makeDeepTree()), SyntaxError);
        const cyclic = { type: 'root', nodes: [] };
        cyclic.nodes.push(cyclic);
        assert.throws(() => walk(cyclic), SyntaxError);
      }
    }
  });
}
