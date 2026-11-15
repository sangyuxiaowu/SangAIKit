import { expect, it } from 'vitest';
import { redactRequestSnapshot } from './DemoRequestInspector';

it('redacts image data while preserving the final request body for inspection', () => {
  const request = redactRequestSnapshot({
    endpoint: 'https://example.com/v1/responses',
    body: {
      instructions: 'this is a test',
      tools: [{ type: 'function', name: 'skill', parameters: { type: 'object' } }],
      input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,QUJDRA==' }] }]
    }
  });
  expect(request.endpoint).toBe('https://example.com/v1/responses');
  expect(request.body.instructions).toBe('this is a test');
  expect(request.body.tools).toEqual([{ type: 'function', name: 'skill', parameters: { type: 'object' } }]);
  expect(JSON.stringify(request.body)).toContain('[image payload redacted: about 6 bytes]');
  expect(JSON.stringify(request.body)).not.toContain('QUJDRA==');
});
