/* SPDX-License-Identifier: LicenseRef-Aitherium-Proprietary
 * © 2026 Aitherium, LLC. Original work.
 *
 * Tests for ChatML renderer with tool calling support.
 */

import { renderChatML, type ChatMessage, type ToolFunction } from '../chat_template';

describe('renderChatML', () => {
  // Out-of-band context (a clock, a page title, a retrieval hit) must reach the
  // model as DATA, never fused into the visitor's own words. Live 2026-08-18:
  // the greeter appended `[local time ... America/Los_Angeles]` to the last user
  // message, and a visitor who typed `hi` was answered with the time and the
  // IANA timezone -- a string they never typed and no other tier emits. These
  // two tests pin the shape of that fix and the trap next to it.
  describe('out-of-band context placement', () => {
    it('a tool turn renders as data, and does NOT land inside the user turn', () => {
      const result = renderChatML(
        [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'hi' },
          { role: 'tool', content: 'local time is 2:30 PM - America/Los_Angeles' },
        ] as ChatMessage[],
        false,
      );

      expect(result).toContain('<tool_response>');
      expect(result).toContain('America/Los_Angeles');
      // The visitor's turn is exactly what they typed.
      expect(result).toContain('<|im_start|>user\nhi<|im_end|>');
      // ...and the clock is not welded onto it.
      expect(result).not.toContain('hi\n\nlocal time');
    });

    it('a MID-CONVERSATION system turn renders as NOTHING (do not use one here)', () => {
      // The render loop has branches for user, assistant and tool only, so a
      // system message anywhere but position 0 is silently dropped. Switching
      // the clock to `system` looks tidier and would delete it -- the time would
      // simply be unknown, with nothing failing to say so.
      const result = renderChatML(
        [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'hi' },
          { role: 'system', content: 'local time is 2:30 PM' },
        ] as ChatMessage[],
        false,
      );

      expect(result).not.toContain('local time is 2:30 PM');
    });
  });

  describe('basic ChatML (no tools)', () => {
    it('renders system + user + assistant messages', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const result = renderChatML(messages, false);

      expect(result).toContain('<|im_start|>system');
      expect(result).toContain('You are helpful.');
      expect(result).toContain('<|im_start|>user');
      expect(result).toContain('Hello');
      expect(result).toContain('<|im_start|>assistant');
      expect(result).toContain('Hi there!');
      expect(result).toContain('<|im_end|>');
    });

    it('adds generation prompt with thinking block when requested', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
      const result = renderChatML(messages, true);

      expect(result).toContain('<|im_start|>assistant');
      expect(result).toContain('<think>');
      expect(result).toContain('</think>');
    });

    it('preserves assistant reasoning_content', () => {
      const messages: ChatMessage[] = [
        { role: 'assistant', content: 'The answer is 42.', reasoning_content: 'Let me think... 6 * 7...' },
      ];

      const result = renderChatML(messages, false);

      expect(result).toContain('<think>');
      expect(result).toContain('Let me think... 6 * 7...');
      expect(result).toContain('</think>');
      expect(result).toContain('The answer is 42.');
    });

    it('byte-identical to existing output when no tools', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User message' },
        { role: 'assistant', content: 'Assistant reply' },
      ];

      const oldBehavior = messages.map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`).join('');
      const newBehavior = renderChatML(messages, false);

      expect(newBehavior).toContain(oldBehavior);
    });
  });

  describe('tools support', () => {
    const tools: ToolFunction[] = [
      {
        name: 'get_time',
        description: 'Get the current time',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'add',
        description: 'Add two numbers',
        parameters: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['a', 'b'],
        },
      },
    ];

    it('renders tools as system message', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'What time is it?' }];

      const result = renderChatML(messages, false, tools);

      expect(result).toContain('<|im_start|>system');
      expect(result).toContain('# Tools');
      expect(result).toContain('<tools>');
      expect(result).toContain('</tools>');
      expect(result).toContain('get_time');
      expect(result).toContain('add');
      expect(result).toContain('tool_call');
    });

    it('includes existing system message in tools block', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Hello' },
      ];

      const result = renderChatML(messages, false, tools);

      // System message should be in the tools block
      expect(result).toContain('Be helpful.');
      expect(result).toContain('# Tools');
      // Should not have a separate system block after tools
      const systemMatches = result.match(/<\|im_start\|>system/g) || [];
      expect(systemMatches).toHaveLength(1);
    });

    it('skips system message from tools block when rendering messages', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Hello' },
      ];

      const result = renderChatML(messages, false, tools);

      // Should have exactly one system block (in tools), then user
      const parts = result.split('<|im_start|>');
      const systemPart = parts.find((p) => p.startsWith('system'));
      const userPartAfter = parts.slice(parts.indexOf(systemPart!) + 1);
      expect(userPartAfter.some((p) => p.startsWith('user'))).toBe(true);
    });
  });

  describe('tool calls in messages', () => {
    it('renders assistant tool_calls', () => {
      const messages: ChatMessage[] = [
        {
          role: 'assistant',
          content: 'Let me check the time.',
          tool_calls: [
            {
              function: {
                name: 'get_time',
                arguments: {},
              },
            },
          ],
        },
      ];

      const result = renderChatML(messages, false);

      expect(result).toContain('<tool_call>');
      expect(result).toContain('"name":"get_time"');
      expect(result).toContain('</tool_call>');
    });

    it('renders multiple tool calls', () => {
      const messages: ChatMessage[] = [
        {
          role: 'assistant',
          content: 'Computing...',
          tool_calls: [
            {
              function: {
                name: 'get_time',
                arguments: {},
              },
            },
            {
              function: {
                name: 'add',
                arguments: { a: 2, b: 3 },
              },
            },
          ],
        },
      ];

      const result = renderChatML(messages, false);

      const toolCallMatches = result.match(/<tool_call>/g) || [];
      expect(toolCallMatches).toHaveLength(2);
      expect(result).toContain('get_time');
      expect(result).toContain('add');
      expect(result).toContain('"a":2');
      expect(result).toContain('"b":3');
    });

    it('formats arguments correctly', () => {
      const messages: ChatMessage[] = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              function: {
                name: 'add',
                arguments: { a: 10, b: 20 },
              },
            },
          ],
        },
      ];

      const result = renderChatML(messages, false);

      expect(result).toContain('"name":"add"');
      expect(result).toContain('"a":10');
      expect(result).toContain('"b":20');
    });
  });

  describe('tool role (results)', () => {
    it('renders tool response', () => {
      const messages: ChatMessage[] = [
        {
          role: 'assistant',
          content: 'Calling get_time',
          tool_calls: [{ function: { name: 'get_time', arguments: {} } }],
        },
        {
          role: 'tool',
          content: 'Current time: 3:45 PM',
        },
      ];

      const result = renderChatML(messages, false);

      expect(result).toContain('<|im_start|>user');
      expect(result).toContain('<tool_response>');
      expect(result).toContain('Current time: 3:45 PM');
      expect(result).toContain('</tool_response>');
      expect(result).toContain('<|im_end|>');
    });

    it('wraps tool response in user turn', () => {
      const messages: ChatMessage[] = [
        {
          role: 'tool',
          content: 'Result: 42',
        },
      ];

      const result = renderChatML(messages, false);

      // Should wrap in <|im_start|>user ... <|im_end|>
      expect(result).toContain('<|im_start|>user');
      expect(result).toContain('</tool_response><|im_end|>');
    });
  });

  describe('edge cases', () => {
    it('handles empty content', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: '' }];
      const result = renderChatML(messages, false);
      expect(result).toContain('<|im_start|>user');
      expect(result).toContain('<|im_end|>');
    });

    it('handles special characters in content', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'What\'s "this"? <tag>content</tag>\n\n' },
      ];
      const result = renderChatML(messages, false);
      expect(result).toContain('What\'s "this"? <tag>content</tag>');
    });

    it('handles reasoning without content', () => {
      const messages: ChatMessage[] = [
        {
          role: 'assistant',
          content: '',
          reasoning_content: 'Thinking...',
          tool_calls: [{ function: { name: 'get_time', arguments: {} } }],
        },
      ];
      const result = renderChatML(messages, false);
      expect(result).toContain('<think>');
      expect(result).toContain('Thinking...');
      expect(result).toContain('</think>');
      expect(result).toContain('<tool_call>');
    });

    it('handles mixed message types', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'Help' },
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1', tool_calls: [{ function: { name: 'f', arguments: {} } }] },
        { role: 'tool', content: 'R1' },
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: 'A2' },
      ];
      const result = renderChatML(messages, false);
      expect(result).toContain('Help');
      expect(result).toContain('Q1');
      expect(result).toContain('A1');
      expect(result).toContain('R1');
      expect(result).toContain('Q2');
      expect(result).toContain('A2');
    });
  });

  describe('generation prompt', () => {
    it('emits generation prompt with thinking', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
      const result = renderChatML(messages, true);

      // Should end with assistant + think block
      expect(result).toMatch(/<think>\n\n<\/think>\n\n$/);
    });

    it('skips generation prompt when false', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
      const result = renderChatML(messages, false);

      expect(result).not.toContain('<|im_start|>assistant\n<think>');
    });
  });
});
