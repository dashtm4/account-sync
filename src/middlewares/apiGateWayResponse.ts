/* eslint-disable no-console */
/* eslint-disable no-param-reassign */
import { MiddlewareObject } from 'middy';
import Boom from '@hapi/boom';
import { cors } from 'middy/middlewares';

import {
    APIGatewayResponse,
    APIGatewayResponseClass,
    ErrorResponse,
    ResponsePayload,
} from '../utils/aws';
import type {
    APIGatewayEvent,
} from '../types/aws';

export function apiGatewayResponse<
    TEvent extends
    | APIGatewayEvent<unknown>,
    TResponse extends APIGatewayResponse<any>
>(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ignoredOpts: {} = {},
): MiddlewareObject<TEvent, APIGatewayResponse<ResponsePayload<TResponse>>> {
    return {
        after: (handler, next) => {
            if (!(handler.response instanceof APIGatewayResponseClass)) {
                handler.response = new APIGatewayResponseClass({
                    body: handler.response,
                });
            }

            cors().after?.(handler, next);
        },
        onError: (handler, next) => {
            console.error(handler.error);

            let error: any;
            if (Boom.isBoom(handler.error)) {
                error = handler.error;
            } else {
                error = Boom.internal(handler.error.message);
                error.name = 'InternalError';
            }

            handler.response = new APIGatewayResponseClass<ErrorResponse>({
                statusCode: error.output.statusCode,
                body: {
                    error: {
                        type: error.name,
                        status: error.output.payload.error,
                        message:
                            error.output.statusCode === 500
                                ? undefined
                                : error.message,
                        payload: error.data ?? undefined,
                    },
                },
            });

            delete handler.error;

            cors().after?.(handler, next);
        },
    };
}
