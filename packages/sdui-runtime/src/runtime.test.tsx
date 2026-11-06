import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenRenderer } from './ScreenRenderer';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const goodSpec = {
  root: 'page',
  state: { form: { alias: 'beta', version: '5' } },
  elements: {
    page: { type: 'Page', props: { title: 'Versions' }, children: ['field', 'btn'] },
    field: { type: 'TextField', props: { label: 'Version', value: { $bindState: '/form/version' } }, children: [] },
    btn: {
      type: 'Button',
      props: { label: 'Move alias', testId: 'move' },
      children: [],
      on: {
        press: {
          action: 'submit',
          params: { action: 'setAlias', payload: { app: 'a', alias: { $state: '/form/alias' }, version: { $number: '/form/version' } } },
        },
      },
    },
  },
};

afterEach(cleanup);

describe('ScreenRenderer', () => {
  it('shows a visible error state for an invalid spec', async () => {
    const fetchMock = vi.fn(async () => json({ root: 'page', elements: { page: { type: 'Page', props: { title: 7 }, children: [] } } }));
    render(<ScreenRenderer config={{ bffBase: '', fetch: fetchMock }} mfe="releases" screen="versions" navigate={() => {}} />);
    const error = await screen.findByTestId('screen-error');
    expect(error.textContent).toContain('could not be displayed');
    expect(error.textContent).toContain('elements.page.props.title');
  });

  it('shows the BFF error for a failed request', async () => {
    const fetchMock = vi.fn(async () => json({ title: 'Forbidden', status: 403, detail: 'no access' }, 403));
    render(<ScreenRenderer config={{ bffBase: '', fetch: fetchMock }} mfe="admin" screen="grants" navigate={() => {}} />);
    expect((await screen.findByTestId('screen-error')).textContent).toContain('do not have access');
  });

  it('renders a valid spec and submits actions with state resolved', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return json({ ok: true, message: 'Alias moved' });
      }
      return json(goodSpec);
    });
    render(<ScreenRenderer config={{ bffBase: '', fetch: fetchMock as typeof fetch }} mfe="releases" screen="versions" params={{ decision: 'eligibility' }} navigate={() => {}} />);
    expect(await screen.findByText('Versions')).toBeTruthy();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/bff/releases/screens/versions?decision=eligibility');
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: '4' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('move'));
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ url: '/bff/releases/actions/setAlias', body: { app: 'a', alias: 'beta', version: 4 } });
    expect((await screen.findByTestId('toast')).textContent).toBe('Alias moved');
  });
});
