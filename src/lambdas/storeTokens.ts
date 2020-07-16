import AWS from 'aws-sdk';
import middy from 'middy';
import { v4 as uuidv4 } from 'uuid';
import { jsonBodyParser } from 'middy/middlewares';
import OAuthClient from 'intuit-oauth';
import { APIGatewayEvent, ATokenEvent, DefaultResponse } from '../types/aws';
import { APIGatewayResponse } from '../utils/aws';
import { apiGatewayResponse } from '../middlewares/apiGateWayResponse';

const dynamoDb = new AWS.DynamoDB.DocumentClient();

const oauthClient = new OAuthClient({
    clientId: process.env.clientId!,
    clientSecret: process.env.clientSecret!,
    environment: 'sandbox',
    redirectUri: 'http://localhost:8080',
});

const rawHandler = async (event: APIGatewayEvent<ATokenEvent>)
: Promise<APIGatewayResponse<DefaultResponse>> => {
    const { code } = event.body;

    const { sub: cognitoId } = event.requestContext.authorizer.claims;

    const authResponse = await oauthClient.createToken(code);

    const tokens = authResponse.getToken();

    await dynamoDb.put({
        TableName: process.env.clientsTable!,
        Item: {
            Id: uuidv4(),
            CognitoId: cognitoId,
            Access_token: tokens.access_token,
            Refresh_token: tokens.refresh_token,
        },
    }).promise();

    return Promise.resolve({ message: 'Account successfully connected, tokens are stored in database' });
};

export const handler = middy(rawHandler)
    .use(jsonBodyParser())
    .use(apiGatewayResponse<APIGatewayEvent<ATokenEvent>,
    APIGatewayResponse<DefaultResponse>>());
