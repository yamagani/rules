import type { ProblemDetails } from '@rules/schemas';

/** An error that becomes an RFC 7807 response. rules-service problems pass through unchanged. */
export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly body: ProblemDetails & Record<string, unknown>,
  ) {
    super(body.detail ?? body.title);
  }
}

export const problem = (status: number, title: string, detail?: string, extra: Record<string, unknown> = {}) =>
  new HttpProblem(status, { type: 'about:blank', title, status, detail, ...extra });
