import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';

describe('App', () => {
  it('renders the product name', () => {
    const html = renderToString(<App />);

    expect(html).toContain('<h1>Race Control</h1>');
  });
});
