import Boom from '@hapi/boom';
import middy from 'middy';
import { jsonBodyParser } from 'middy/middlewares';
import OAuthClient from 'intuit-oauth';
import { APIGatewayEvent, DefaultEvent } from '../types/aws';
import { APIGatewayResponse } from '../utils/aws';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';

interface IntuitAPIResponse {
    redirectUri: string;
}

const oauthClient = new OAuthClient({
    clientId: process.env.clientId!,
    clientSecret: process.env.clientSecret!,
    environment: 'sandbox',
    redirectUri: 'https://www.google.com/',
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const rawHandler = async (event: APIGatewayEvent<DefaultEvent>)
: Promise<APIGatewayResponse<IntuitAPIResponse>> => {
    try {
        const authUri: string = oauthClient.authorizeUri({
            scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
        });

        return Promise.resolve({ redirectUri: authUri });
    } catch (e) {
        throw Boom.badRequest('Error during redirectUri request');
    }
};
export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(apiGatewayResponse<APIGatewayEvent<DefaultEvent>,
    APIGatewayResponse<IntuitAPIResponse>>());
