/**
 * Thrown from anywhere in the pipeline to produce an HTTP error response. The body is
 * `{ statusCode, message, error }` unless an object is supplied, which is sent as-is.
 */
export type HeaderInit = Headers | Record<string, string> | [string, string][];

export class HttpException extends Error {
  override readonly name: string = 'HttpException';

  constructor(
    readonly status: number,
    readonly response: string | Record<string, unknown> = defaultMessage(status),
    options?: { cause?: unknown; headers?: HeaderInit },
  ) {
    super(
      typeof response === 'string'
        ? response
        : (String(response.message) ?? defaultMessage(status)),
      {
        cause: options?.cause,
      },
    );
    this.headers = options?.headers;
  }

  readonly headers: HeaderInit | undefined;

  /** Body sent to the client. */
  getBody(): Record<string, unknown> {
    if (typeof this.response === 'string') {
      return {
        statusCode: this.status,
        message: this.response,
        error: defaultMessage(this.status),
      };
    }
    return this.response;
  }

  toResponse(): Response {
    return Response.json(
      this.getBody(),
      this.headers ? { status: this.status, headers: this.headers } : { status: this.status },
    );
  }
}

const MESSAGES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  412: 'Precondition Failed',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  418: "I'm a teapot",
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export function defaultMessage(status: number): string {
  return MESSAGES[status] ?? `HTTP ${status}`;
}

type Body = string | Record<string, unknown>;

function define(status: number, name: string) {
  return class extends HttpException {
    override readonly name = name;
    constructor(response?: Body, options?: { cause?: unknown; headers?: HeaderInit }) {
      super(status, response, options);
    }
  };
}

export const BadRequestException = define(400, 'BadRequestException');
export const UnauthorizedException = define(401, 'UnauthorizedException');
export const ForbiddenException = define(403, 'ForbiddenException');
export const NotFoundException = define(404, 'NotFoundException');
export const MethodNotAllowedException = define(405, 'MethodNotAllowedException');
export const NotAcceptableException = define(406, 'NotAcceptableException');
export const RequestTimeoutException = define(408, 'RequestTimeoutException');
export const ConflictException = define(409, 'ConflictException');
export const GoneException = define(410, 'GoneException');
export const PreconditionFailedException = define(412, 'PreconditionFailedException');
export const PayloadTooLargeException = define(413, 'PayloadTooLargeException');
export const UnsupportedMediaTypeException = define(415, 'UnsupportedMediaTypeException');
export const UnprocessableEntityException = define(422, 'UnprocessableEntityException');
export const TooManyRequestsException = define(429, 'TooManyRequestsException');
export const InternalServerErrorException = define(500, 'InternalServerErrorException');
export const NotImplementedException = define(501, 'NotImplementedException');
export const BadGatewayException = define(502, 'BadGatewayException');
export const ServiceUnavailableException = define(503, 'ServiceUnavailableException');
export const GatewayTimeoutException = define(504, 'GatewayTimeoutException');
